//! Ventana de NetOps Suite: arranca el servidor local (carpeta netops-server: FastAPI + SQLite), espera a que
//! avise «NETOPS_READY <puerto>» y ENTONCES crea la ventana apuntando a http://127.0.0.1:<puerto>/ .
//! Al cerrar, detiene el servidor. Cada paso queda en %LOCALAPPDATA%\NetOpsSuite\shell.log.
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Server(Mutex<Option<Child>>);

fn log(msg: &str) {
    let base = std::env::var("LOCALAPPDATA").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("NetOpsSuite");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("shell.log")) {
        let _ = writeln!(f, "{msg}");
    }
}

fn spawn_server(app: &tauri::AppHandle) -> Result<Child, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let exe = dir.join("netops-server").join("netops-server.exe");
    log(&format!("servidor: {}", exe.display()));
    let mut cmd = Command::new(&exe);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("No se pudo iniciar {}: {}", exe.display(), e))
}

fn open_window(handle: &tauri::AppHandle, port: Option<u16>) {
    let url = match port {
        Some(p) => WebviewUrl::External(format!("http://127.0.0.1:{p}/").parse().unwrap()),
        None => WebviewUrl::App("index.html".into()),
    };
    let r = WebviewWindowBuilder::new(handle, "main", url)
        .title("NetOps Suite")
        .inner_size(1360.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .build();
    match r {
        Ok(_) => log("ventana creada"),
        Err(e) => log(&format!("ERROR al crear la ventana: {e}")),
    }
}

pub fn run() {
    log("=== inicio de la aplicación ===");
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let mut child = match spawn_server(&handle) {
                Ok(c) => c,
                Err(e) => {
                    log(&e);
                    open_window(&handle, None);
                    return Ok(());
                }
            };
            let stdout = child.stdout.take();
            *handle.state::<Server>().0.lock().unwrap() = Some(child);
            std::thread::spawn(move || {
                let Some(out) = stdout else { return };
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Some(p) = line.strip_prefix("NETOPS_READY ") {
                        log(&format!("servidor listo: puerto {}", p.trim()));
                        match p.trim().parse::<u16>() {
                            Ok(port) => {
                                let h = handle.clone();
                                // la ventana se crea desde el hilo principal de la aplicación
                                let _ = handle.run_on_main_thread(move || open_window(&h, Some(port)));
                            }
                            Err(e) => log(&format!("puerto inválido: {e}")),
                        }
                        break;
                    }
                }
                log("fin de la lectura del servidor");
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
