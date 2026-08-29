//! Asset ingestion. Bytes stay in the backend; the frontend only ever handles
//! the generated names.

use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

/// Copies a local file into the project's asset store and returns its new name.
#[tauri::command]
pub fn import_asset(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let path = Path::new(&path);
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_ASSET_BYTES {
        return Err(AppError::Invalid(format!(
            "asset exceeds the {} MiB limit",
            MAX_ASSET_BYTES / 1024 / 1024
        )));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = std::fs::read(path)?;
    let name = state.next_asset_name(&ext);
    state.put_asset(name.clone(), bytes);
    Ok(name)
}

/// Stores bytes that the frontend already holds (e.g. a pasted or dropped file).
#[tauri::command]
pub fn put_asset_bytes(
    state: State<'_, AppState>,
    extension: String,
    bytes: Vec<u8>,
) -> AppResult<String> {
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err(AppError::Invalid("asset too large".into()));
    }
    let name = state.next_asset_name(&extension.to_ascii_lowercase());
    state.put_asset(name.clone(), bytes);
    Ok(name)
}

#[tauri::command]
pub fn list_assets(state: State<'_, AppState>) -> Vec<String> {
    state.asset_names()
}
