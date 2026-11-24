"""Server-only stdout audit. Never emits full argv, environment, or job bodies."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

PROJECT = re.compile(r"mooyu|gamehub|agent[-_].*(?:worker|schedul)|qq[-_]?channel|paper[-_]study", re.I)
errors = []

def run(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        if result.returncode:
            errors.append({"command": args[0], "status": result.returncode})
            return ""
        return result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        errors.append({"command": args[0], "error": type(error).__name__})
        return ""

ids = run(["docker", "ps", "-aq"]).split()
containers = json.loads(run(["docker", "inspect", *ids]) or "[]") if ids else []
runners = []
for c in containers:
    labels = c["Config"].get("Labels") or {}
    project = labels.get("com.docker.compose.project")
    args = (c["Config"].get("Entrypoint") or []) + (c["Config"].get("Cmd") or [])
    scripts = [Path(v).name for v in args
               if re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|py|sh)", Path(v).name)]
    socket = any(m.get("Destination", "").endswith(("docker.sock", "containerd.sock"))
                 for m in c.get("Mounts", []))
    environment = dict(v.split("=", 1) for v in c["Config"].get("Env", []) if "=" in v)
    remote_docker = bool(environment.get("DOCKER_HOST"))
    relevant = PROJECT.search(" ".join(args)) or socket or remote_docker
    if project in {"gamehub-production", "mooyu-qq"}:
        relevant = relevant or labels.get("com.docker.compose.service") in {"api", "web", "worker", "napcat"}
    if relevant:
        runners.append({"container": c["Name"].lstrip("/"), "project": project,
                        "service": labels.get("com.docker.compose.service"),
                        "image": c["Image"], "running": c["State"]["Running"],
                        "restart": c["HostConfig"].get("RestartPolicy", {}).get("Name"),
                        "scripts": scripts, "dockerSocket": socket,
                        "remoteDockerEndpointPresent": remote_docker,
                        "paperFlags": {k: environment[k] if environment.get(k) in {"true", "false"}
                                       else "unset" if k not in environment else "unexpected"
                                       for k in ["PAPER_STUDY_ENABLED", "PAPER_STUDY_WORKER_ENABLED",
                                                 "PAPER_STUDY_MODELS_ENABLED", "PAPER_STUDY_PUBLISH_ENABLED",
                                                 "AGENT_PAPER_SEMANTIC_ENABLED", "AGENT_PAPER_RESEARCH_WORKER_ENABLED"]}})

host_processes = []
for p in Path("/proc").iterdir():
    if not p.name.isdigit():
        continue
    try:
        args = (p / "cmdline").read_bytes().decode(errors="replace").split("\0")
        cwd = os.readlink(p / "cwd")
        if not PROJECT.search(" ".join(args) + " " + cwd):
            continue
        group = (p / "cgroup").read_text(errors="replace")
        owner = next((c["Name"].lstrip("/") for c in containers
                      if c["Id"] in group or c["State"].get("Pid") == int(p.name)), None)
        if owner is None:
            scripts = [Path(v).name for v in args
                       if re.fullmatch(r"[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|py|sh)", Path(v).name)]
            host_processes.append({"pid": int(p.name), "scripts": scripts,
                                   "projectWorkingDirectory": bool(PROJECT.search(cwd))})
    except (FileNotFoundError, ProcessLookupError):
        pass
    except (OSError, PermissionError) as error:
        errors.append({"source": "proc", "error": type(error).__name__})

unit_state = {}
for kind in ["service", "timer"]:
    for line in run(["systemctl", "list-unit-files", "--type=" + kind,
                     "--no-legend", "--no-pager"]).splitlines():
        fields = line.split()
        if len(fields) >= 2:
            unit_state[fields[0]] = fields[1]

roots = ["/etc/systemd/system", "/usr/lib/systemd/system", "/lib/systemd/system",
         "/etc/cron.d", "/var/spool/cron", "/www/server/cron",
         "/etc/supervisor", "/etc/supervisord.d"]
files = {Path("/etc/crontab"), Path("/root/.pm2/dump.pm2")}
for root in roots:
    p = Path(root)
    if p.is_dir():
        files.update(p.rglob("*"))
controllers, seen, large = [], set(), []
for original in sorted(files):
    try:
        p = original.resolve()
        if p in seen or not p.is_file() or ".log" in p.name:
            continue
        seen.add(p)
        if "/systemd/" in str(p) and p.suffix not in {".service", ".timer"}:
            continue
        if p.stat().st_size > 262144:
            large.append(str(original))
            continue
        data = p.read_bytes()
        text = data.decode(errors="replace")
        docker = bool(re.search(r"docker|podman|watchtower|portainer", text, re.I))
        starts = docker and bool(re.search(r"(?:^|[\s;|&])(?:up|start|restart|run)(?:[\s;|&]|$)", text))
        manager = bool(re.search(r"pm2|supervisor", text, re.I))
        if PROJECT.search(text) or PROJECT.search(str(original)) or starts or manager or "/www/server/cron/" in text:
            controllers.append({"file": str(original), "sha256": hashlib.sha256(data).hexdigest(),
                                "unitState": unit_state.get(p.name),
                                "pairedTimerState": unit_state.get(p.stem + ".timer"),
                                "mayStartContainers": starts, "processManager": manager,
                                "projectReference": bool(PROJECT.search(text)),
                                "composeReference": docker and "compose" in text.lower(),
                                "mentionsPaper": bool(re.search(r"paper|论文", text, re.I))})
    except (FileNotFoundError, ProcessLookupError):
        pass
    except (OSError, PermissionError) as error:
        errors.append({"source": "startup-files", "error": type(error).__name__})

target_images = {
    "api": "sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe",
    "worker": "sha256:efc4944ddc0ecdb477d539e8e36cad276aab6f9a7351e95b01c0a7688a1c8c1d",
    "web": "sha256:b41b96165cfce091ef8890debda68c2920cc0fc18f775f21e70572ee6613fdcb",
    "rollbackApi": "sha256:22b7b18cc870b51167826683f163f24b550bba69910e027c3576ce1180252ed2"
}
cache = []
for role, image in target_images.items():
    try:
        r = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", image],
                           capture_output=True, text=True, timeout=20)
        cache.append({"role": role, "image": image,
                      "available": r.returncode == 0 and r.stdout.strip() == image})
    except (OSError, subprocess.TimeoutExpired) as error:
        errors.append({"source": "image-cache", "error": type(error).__name__})

status = run(["git", "--no-optional-locks", "-C", "/www/gamehub", "status", "--short"]).splitlines()
repository = {"branch": run(["git", "--no-optional-locks", "-C", "/www/gamehub", "branch", "--show-current"]),
              "commit": run(["git", "--no-optional-locks", "-C", "/www/gamehub", "rev-parse", "HEAD"]),
              "status": status[:30], "statusTruncated": len(status) > 30}

for section, result in [("Docker执行与管理候选", runners),
                        ("非Docker进程候选", host_processes),
                        ("持久启动入口候选", controllers),
                        ("待发布镜像本机缓存", cache),
                        ("服务器Git只读状态", repository),
                        ("覆盖限制", {"errors": errors, "largeFilesNotRead": large,
                                     "automaticallyApproved": False})]:
    print(section + "\n" + json.dumps(result, ensure_ascii=False), flush=True)
