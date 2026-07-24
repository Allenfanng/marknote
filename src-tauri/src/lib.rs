use std::fs;
use rfd::AsyncFileDialog;
use tauri::{Emitter, Listener, Manager};

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<String>, String> {
    let file = AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "txt"])
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
        .set_title("Save Markdown File")
        .save_file()
        .await;

    match file {
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
                if ext == "md" || ext == "markdown" {
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
    Ok(files)
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
}}
</style>
</head>
<body>
<div class="markdown-body">
{markdown}
</div>
</body>
</html>"#);
    let tmp_dir = std::env::temp_dir().join("marknote-export");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let file_path = tmp_dir.join("document.html");
    fs::write(&file_path, &html).map_err(|e| format!("Failed to write HTML: {}", e))?;
    open::that(&file_path).map_err(|e| format!("Failed to open browser: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            open_file_dialog,
            save_file_dialog,
            list_dir_files,
            get_recent_files,
            add_recent_file,
            export_html,
            export_pdf,
        ])
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv.iter() {
                let lower = arg.to_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") {
                    if std::path::Path::new(arg).exists() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("file-opened", arg.clone());
                        break;
                    }
                }
            }
        }))
        .setup(|app| {
            // Check for file path in CLI args (file association on Windows)
            let args: Vec<String> = std::env::args().collect();
            for arg in args.iter().skip(1) {
                let path = arg.clone();
                let lower = path.to_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") {
                    if std::path::Path::new(&path).exists() {
                        let app_handle = app.handle().clone();
                        // Wait for frontend-ready event instead of fixed delay
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
