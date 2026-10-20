from __future__ import annotations

import json
import os
import subprocess
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlparse
from ipaddress import ip_address


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("WRAITH_HOST", "127.0.0.1")
PORT = int(os.environ.get("WRAITH_PORT", "8765"))
MAX_BODY_BYTES = 1_000_000


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, value.strip().strip("\"'"))


class WraithHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Wraith/0.1"

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError as exc:
            raise ValueError("A valid Content-Length header is required.") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("Request body must be valid JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _is_local_request(self) -> bool:
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0].strip("[]").lower()
        if hostname != "localhost":
            try:
                if not ip_address(hostname).is_loopback:
                    return False
            except ValueError:
                return False

        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            origin_host = (parsed.hostname or "").lower()
            try:
                is_loopback = origin_host == "localhost" or ip_address(origin_host).is_loopback
            except ValueError:
                is_loopback = False
            if not is_loopback or parsed.port != self.server.server_port:
                return False
        return True

    def do_GET(self) -> None:
        if not self._is_local_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Wraith only accepts requests from this local browser."})
            return
        route = urlparse(self.path).path
        if route == "/api/status":
            self._send_json(HTTPStatus.OK, self._provider_status())
            return
        if route not in ("/", "/index.html"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return

        page = ROOT / "web" / "index.html"
        try:
            body = page.read_bytes()
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"UI unavailable: {exc}"})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if not self._is_local_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Wraith only accepts requests from this local browser."})
            return
        if urlparse(self.path).path != "/api/chat":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        try:
            payload = self._read_json()
            message = payload.get("message")
            if not isinstance(message, str) or not message.strip():
                raise ValueError("Message cannot be empty.")
            providers = payload.get("providers", ["chatgpt"])
            if not isinstance(providers, list) or not providers:
                raise ValueError("Select at least one provider.")
            if any(not isinstance(provider, str) for provider in providers):
                raise ValueError("Provider names must be strings.")
            history = payload.get("history", [])
            if not isinstance(history, list):
                raise ValueError("Conversation history must be a list.")

            request = {
                "message": message.strip(),
                "providers": providers,
                "history": history[-20:],
            }
            self._stream_chat(request)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def _provider_status(self) -> dict:
        defaults = [
            provider.strip().lower()
            for provider in os.environ.get("WRAITH_DEFAULT_PROVIDERS", "chatgpt").split(",")
            if provider.strip()
        ]
        return {
            "providers": [
                {"id": "chatgpt", "name": "ChatGPT (Codex)", "login": True, "enabled": True},
                {"id": "copilot", "name": "GitHub Copilot", "login": True, "enabled": True},
                {"id": "deepseek", "name": "DeepSeek", "login": False, "enabled": bool(os.environ.get("DEEPSEEK_API_KEY"))},
                {"id": "github", "name": "GitHub Models", "login": False, "enabled": bool(os.environ.get("GITHUB_MODELS_TOKEN") or os.environ.get("GITHUB_TOKEN"))},
                {"id": "openai", "name": "OpenAI API", "login": False, "enabled": bool(os.environ.get("OPENAI_API_KEY"))},
            ],
            "defaultProviders": defaults,
        }

    def _stream_chat(self, request: dict) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def send_event(event: dict) -> None:
            body = json.dumps(event, ensure_ascii=False).encode("utf-8") + b"\n"
            self.wfile.write(f"{len(body):X}\r\n".encode("ascii"))
            self.wfile.write(body + b"\r\n")
            self.wfile.flush()

        try:
            process = subprocess.Popen(
                ["node", str(ROOT / "src" / "web-runner.js")],
                cwd=ROOT,
                env=os.environ.copy(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
            )
            assert process.stdin is not None
            assert process.stdout is not None
            process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            process.stdin.close()

            for line in process.stdout:
                line = line.strip()
                if line:
                    send_event(json.loads(line))

            exit_code = process.wait()
            if exit_code:
                send_event({"event": "error", "data": {"message": f"Wraith worker exited with code {exit_code}."}})
        except (BrokenPipeError, ConnectionResetError):
            if "process" in locals() and process.poll() is None:
                process.terminate()
        except Exception as exc:
            try:
                send_event({"event": "error", "data": {"message": str(exc)}})
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass


class WraithServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    load_dotenv()
    try:
        if HOST != "localhost" and not ip_address(HOST).is_loopback:
            raise ValueError
    except ValueError as exc:
        raise SystemExit("Wraith only binds to localhost for safety. Set WRAITH_HOST to 127.0.0.1 or localhost.") from exc
    server = WraithServer((HOST, PORT), WraithHandler)
    address = f"http://127.0.0.1:{server.server_port}"
    print(f"Wraith is ready at {address}")
    print("Press Ctrl+C to stop the server.")
    threading.Timer(0.5, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Wraith...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
