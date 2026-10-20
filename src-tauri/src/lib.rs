use std::fs;
use rfd::AsyncFileDialog;
use tauri::{Emitter, Listener, Manager};

#[derive(serde::Serialize)]
pub struct ReadFileResult {
    pub content: String,
    pub encoding: String,
}

/// Read a text file, auto-detecting the encoding.
///
/// Order: UTF-8 BOM → UTF-16 LE/BE BOM → strict UTF-8 → GBK fallback.
/// Non-UTF-8 files (common on Chinese Windows) previously failed hard with
/// "stream did not contain valid UTF-8"; now they decode lossily via GBK.
#[tauri::command]
async fn read_file(path: String) -> Result<ReadFileResult, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let content = String::from_utf8_lossy(&bytes[3..]).into_owned();
        return Ok(ReadFileResult { content, encoding: "UTF-8 (BOM)".into() });
    }
    // UTF-16 LE BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return Ok(ReadFileResult { content: cow.into_owned(), encoding: "UTF-16 LE".into() });
    }
    // UTF-16 BE BOM
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return Ok(ReadFileResult { content: cow.into_owned(), encoding: "UTF-16 BE".into() });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadFileResult { content, encoding: "UTF-8".into() }),
        Err(err) => {
            let raw = err.into_bytes();
            let (cow, _, _) = encoding_rs::GBK.decode(&raw);
            Ok(ReadFileResult { content: cow.into_owned(), encoding: "GBK".into() })
        }
    }
}

/// Atomic file write: write to a sibling temp file, then rename over the
/// target. A crash / power loss mid-write can no longer truncate the
/// original file to zero bytes.
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    let dir = target.parent().ok_or_else(|| "Invalid path".to_string())?;
    let file_name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{}.marknote-tmp", file_name));

    fs::write(&tmp, &content).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to write file: {}", e)
    })?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to replace file: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<String>, String> {
    let file = AsyncFileDialog::new()
        .add_filter("Markdown & Text", &["md", "markdown", "txt"])
        .set_title("Open Markdown File")
        .pick_file()
        .await;

    match file {
        Some(handle) => Ok(Some(handle.path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
async fn save_file_dialog() -> Result<Option<String>, String> {
    let file = AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Plain Text", &["txt"])
        .add_filter("All Files", &["*"])
        .set_title("Save Markdown File")
        .save_file()
        .await;

    match file {
        Some(handle) => Ok(Some(handle.path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}

/// 通用"另存为"对话框：导出 SVG / HTML 等非 Markdown 内容时用，
/// 调用方可以自己给默认文件名、标题和扩展名过滤。
#[derive(serde::Deserialize)]
struct SaveFilter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
async fn save_file_as(
    default_name: String,
    title: String,
    filters: Vec<SaveFilter>,
) -> Result<Option<String>, String> {
    let mut dialog = AsyncFileDialog::new()
        .set_file_name(&default_name)
        .set_title(&title);

    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }

    match dialog.save_file().await {
        Some(handle) => Ok(Some(handle.path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
async fn list_dir_files(dir_path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if ext == "md" || ext == "markdown" || ext == "txt" {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(files)
}

#[tauri::command]
async fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let recent_path = data_dir.join("recent.json");
    if !recent_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&recent_path)
        .map_err(|e| format!("Failed to read recent files: {}", e))?;
    let files: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    // 过滤已不存在（被删除/移动）的路径
    Ok(files.into_iter().filter(|p| std::path::Path::new(p).exists()).collect())
}

#[tauri::command]
async fn add_recent_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let recent_path = data_dir.join("recent.json");

    let mut files: Vec<String> = if recent_path.exists() {
        let content = fs::read_to_string(&recent_path)
            .map_err(|e| format!("Failed to read recent files: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    files.retain(|p| p != &path);
    files.insert(0, path);
    files.truncate(20);

    let json = serde_json::to_string_pretty(&files)
        .map_err(|e| format!("Failed to serialize recent files: {}", e))?;
    fs::write(&recent_path, json).map_err(|e| format!("Failed to write recent files: {}", e))?;
    Ok(())
}

/// Open the folder containing `path` in the OS file manager, selecting the file.
#[tauri::command]
async fn open_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // explorer /select,"C:\path\to\file.ext"
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let parent = p.parent().unwrap_or(std::path::Path::new("."));
        open::that(parent).map_err(|e| format!("Failed to open folder: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
async fn export_html(markdown: String, css: String) -> Result<(), String> {
    let file = AsyncFileDialog::new()
        .add_filter("HTML", &["html"])
        .set_title("Export HTML")
        .set_file_name("document.html")
        .save_file()
        .await;

    match file {
        Some(handle) => {
            let html = format!(r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MarkNote Export</title>
<style>
{css}
</style>
</head>
<body>
<div class="markdown-body">
{markdown}
</div>
</body>
</html>"#);
            fs::write(handle.path(), &html)
                .map_err(|e| format!("Failed to write HTML: {}", e))?;
            Ok(())
        }
        None => Ok(()),
    }
}

#[tauri::command]
async fn export_pdf(markdown: String, css: String) -> Result<(), String> {
    // Auto-trigger the browser print dialog (user can "Save as PDF" from there).
    // A visible hint button is included as a fallback in case onload is blocked.
    let html = format!(r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MarkNote Export</title>
<style>
{css}
@media print {{
  body {{ margin: 0; }}
  #print-hint {{ display: none; }}
}}
#print-hint {{
  position: fixed; top: 12px; right: 12px; z-index: 9999;
  padding: 10px 16px; background: #4a6fa5; color: #fff;
  border-radius: 6px; font-family: sans-serif; font-size: 14px;
  cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.2);
}}
</style>
</head>
<body>
<div id="print-hint" onclick="window.print()">打印 / 另存为 PDF (点击此处)</div>
<div class="markdown-body">
{markdown}
</div>
<script>
  window.onload = function() {{
    setTimeout(function() {{ window.print(); }}, 300);
  }};
</script>
</body>
</html>"#);
    let tmp_dir = std::env::temp_dir().join("marknote-export");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // 清理 24 小时前的导出临时文件，防止无限累积
    if let Ok(entries) = fs::read_dir(&tmp_dir) {
        for entry in entries.flatten() {
            let is_old = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() < now_secs() - 24 * 3600)
                .unwrap_or(false);
            if is_old {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // 唯一文件名：连续导出不再互相覆盖
    let file_path = tmp_dir.join(format!("document-{}.html", now_secs()));
    fs::write(&file_path, &html).map_err(|e| format!("Failed to write HTML: {}", e))?;
    open::that(&file_path).map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Restore + focus the main window (used by single-instance & file-open paths).
fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Called by the frontend after it has settled unsaved-tab prompts —
/// actually destroys the window (CloseRequested was intercepted).
#[tauri::command]
async fn confirm_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.destroy();
    }
    Ok(())
}

/// Persist the editing session (open tabs, view modes, unsaved drafts) as an
/// opaque JSON blob. Structure is owned by the frontend; Rust just stores it.
#[tauri::command]
async fn save_session(app: tauri::AppHandle, session: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let path = data_dir.join("session.json");
    // Atomic write, same strategy as write_file
    let tmp = data_dir.join(".session.json.marknote-tmp");
    fs::write(&tmp, &session).map_err(|e| format!("Failed to write session: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to replace session: {}", e))?;
    Ok(())
}

/// Read the persisted session blob. None when never saved.
#[tauri::command]
async fn get_session(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let path = data_dir.join("session.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session: {}", e))?;
    Ok(Some(content))
}

/// Copy an image file (dragged in from Explorer) into `<doc dir>/assets/`,
/// returning the path relative to the document dir.
#[tauri::command]
async fn copy_image_asset(src_path: String, dir: String) -> Result<String, String> {
    let ext = std::path::Path::new(&src_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".into());
    let name = image_file_name(&ext);
    let assets = std::path::Path::new(&dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("Failed to create assets dir: {}", e))?;
    let target = assets.join(&name);
    fs::copy(&src_path, &target).map_err(|e| format!("Failed to copy image: {}", e))?;
    Ok(format!("assets/{}", name))
}

/// Human-friendly unique image file name: img-YYYYMMDD-HHMMSS-xxxx.<ext>
fn image_file_name(ext: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let rand = (now.subsec_nanos() % 0x10000) as u16;
    // 手写时间格式化（避免引入 chrono）：epoch → 天数级展开
    let (y, mo, d, h, mi, s) = epoch_to_datetime(secs);
    format!("img-{:04}{:02}{:02}-{:02}{:02}{:02}-{:04x}.{}", y, mo, d, h, mi, s, rand, ext)
}

/// UTC 民用时间（本地时区差异对本用途无关紧要——只是文件名）
fn epoch_to_datetime(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // days since 1970-01-01 → 民用日期（Howard Hinnant 的 civil_from_days 算法）
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

/// Save a pasted/dropped image next to the document: `<doc dir>/assets/<name>`.
/// Returns the path relative to the document dir (e.g. `assets/img-xxx.png`).
/// The frontend falls back to base64 data URIs for unsaved documents.
#[tauri::command]
async fn save_image_asset(dir: String, data: Vec<u8>, ext: String) -> Result<String, String> {
    let assets = std::path::Path::new(&dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("Failed to create assets dir: {}", e))?;
    let safe_ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let name = image_file_name(if safe_ext.is_empty() { "png" } else { &safe_ext });
    let target = assets.join(&name);
    fs::write(&target, &data).map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(format!("assets/{}", name))
}

/// Batch mtime query for external-change detection (frontend polls this).
/// Returns None for each path that no longer exists.
#[tauri::command]
async fn get_file_mtimes(paths: Vec<String>) -> Result<Vec<Option<i64>>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        let mtime = fs::metadata(p)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);
        out.push(mtime);
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            open_file_dialog,
            save_file_dialog,
            save_file_as,
            list_dir_files,
            get_recent_files,
            add_recent_file,
            open_in_folder,
            export_html,
            export_pdf,
            confirm_close,
            save_session,
            get_session,
            save_image_asset,
            copy_image_asset,
            get_file_mtimes,
        ])
        // Intercept window close: let the frontend prompt for unsaved tabs,
        // then it calls `confirm_close` to actually destroy the window.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv.iter() {
                let lower = arg.to_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt") {
                    if std::path::Path::new(arg).exists() {
                        restore_main_window(app);
                        let _ = app.emit("file-opened", arg.clone());
                        break;
                    }
                }
            }
        }))
        .setup(|app| {
            // Ensure the main window is visible on startup (fixes first-launch
            // after install where the window sometimes fails to appear).
            restore_main_window(app.handle());

            // Check for file path in CLI args (file association on Windows).
            let args: Vec<String> = std::env::args().collect();
            for arg in args.iter().skip(1) {
                let path = arg.clone();
                let lower = path.to_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt") {
                    if std::path::Path::new(&path).exists() {
                        let app_handle = app.handle().clone();
                        app.once("frontend-ready", move |_| {
                            let _ = app_handle.emit("file-opened", path);
                        });
                        break;
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
