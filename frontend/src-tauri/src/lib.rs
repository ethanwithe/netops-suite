//! Ventana de NetOps Suite: arranca el servidor local (netops-server.exe, FastAPI + SQLite), espera a que
//! avise «NETOPS_READY <puerto>» y abre la interfaz en http://127.0.0.1:<puerto>/ . Al cerrar, lo detiene.
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct Server(Mutex<Option<Child>>);

fn spawn_server(app: &tauri::AppHandle) -> Result<Child, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let exe = dir.join("netops-server.exe");
    let mut cmd = Command::new(&exe);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("No se pudo iniciar {}: {}", exe.display(), e))
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let mut child = match spawn_server(&handle) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("{e}");
                    return Ok(());
                }
            };
            let stdout = child.stdout.take();
            *handle.state::<Server>().0.lock().unwrap() = Some(child);
            std::thread::spawn(move || {
                let Some(out) = stdout else { return };
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Some(p) = line.strip_prefix("NETOPS_READY ") {
                        if let (Ok(port), Some(w)) = (p.trim().parse::<u16>(), handle.get_webview_window("main")) {
                            if let Ok(url) = format!("http://127.0.0.1:{port}/").parse() {
                                let _ = w.navigate(url);
                            }
                        }
                        break;
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al iniciar NetOps Suite");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut c) = handle.state::<Server>().0.lock().unwrap().take() {
                let _ = c.kill();
            }
        }
    });
}
