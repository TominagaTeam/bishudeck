//! Reading the HTML a deck is imported from, and writing the HTML it goes back
//! out as. The deck's HTML file is the only persisted form: there is no
//! separate project container.

use std::path::PathBuf;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path)?;
    // AI-generated decks are UTF-8 in practice; fall back to lossy so a stray
    // byte never blocks an import.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Writes a single self-contained HTML file. The document is composed by the
/// frontend; this only persists it alongside any assets it references.
///
/// Autosave takes this same path, so the write must be atomic: the HTML goes to
/// a sibling temp file first and is renamed into place, which means a write cut
/// off half way cannot destroy the previous version of the deck.
#[tauri::command]
pub fn export_html(state: State<'_, AppState>, path: String, html: String) -> AppResult<()> {
    write_deck(&state, &path, &html)
}

fn write_deck(state: &AppState, path: &str, html: &str) -> AppResult<()> {
    let target = PathBuf::from(path);
    let temp = target.with_extension("html.tmp");
    std::fs::write(&temp, html)?;
    std::fs::rename(&temp, &target)?;

    let assets = state.all_assets();
    if !assets.is_empty() {
        let dir = target
            .parent()
            .ok_or_else(|| AppError::Invalid("export path has no parent directory".into()))?
            .join("assets");
        std::fs::create_dir_all(&dir)?;
        for (name, bytes) in assets {
            std::fs::write(dir.join(name), bytes)?;
        }
    }
    Ok(())
}

/// Mirrors the editor's in-memory project so other windows can read it.
#[tauri::command]
pub fn set_live_project(state: State<'_, AppState>, project: serde_json::Value) {
    state.set_live_project(project);
}

#[tauri::command]
pub fn get_live_project(state: State<'_, AppState>) -> Option<serde_json::Value> {
    state.live_project()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECK: &str = "<!doctype html><html><body><section class=\"slide\"><h1>タイトル</h1></section></body></html>";

    fn temp_path(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("hse-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name).to_string_lossy().into_owned()
    }

    #[test]
    fn an_exported_deck_reads_back_verbatim() {
        let state = AppState::default();
        let path = temp_path("round-trip.html");

        write_deck(&state, &path, DECK).unwrap();

        assert_eq!(read_text_file(path).unwrap(), DECK);
    }

    #[test]
    fn assets_are_written_next_to_the_html() {
        let state = AppState::default();
        let path = temp_path("with-assets.html");
        state.put_asset("asset_001.png".into(), vec![1, 2, 3, 4]);

        write_deck(&state, &path, DECK).unwrap();

        let asset = PathBuf::from(&path).parent().unwrap().join("assets/asset_001.png");
        assert_eq!(std::fs::read(asset).unwrap(), vec![1, 2, 3, 4]);
    }

    #[test]
    fn an_interrupted_write_leaves_no_temp_file_behind() {
        let state = AppState::default();
        let path = temp_path("atomic.html");
        write_deck(&state, &path, DECK).unwrap();

        let temp = PathBuf::from(&path).with_extension("html.tmp");
        assert!(!temp.exists(), "temp file should have been renamed away");
        assert!(PathBuf::from(&path).exists());
    }

}
