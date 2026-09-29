// WebView2 memory target. Tauri doesn't expose `MemoryUsageTargetLevel`, so this sets it
// on the underlying controller. "Low" makes WebView2 trim caches and page out working set;
// the frontend switches to it while the window is minimized. No-op on other platforms.

// async: sync commands run on the main thread, where `with_webview` also runs (deadlock).
#[tauri::command]
pub async fn webview_memory_low(webview: tauri::Webview, low: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let (tx, rx) = std::sync::mpsc::channel();
        webview
            .with_webview(move |pv| {
                let result = (|| unsafe {
                    let wv = pv.controller().CoreWebView2()?.cast::<ICoreWebView2_19>()?;
                    wv.SetMemoryUsageTargetLevel(if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    })
                })();
                let _ = tx.send(result.map_err(|e| e.to_string()));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, low);
        Ok(())
    }
}
