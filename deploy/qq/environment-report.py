"""Read-only QQ runtime comparison. Prints allowlisted metadata, never Docker env dumps."""
import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def capture(args):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, timeout=20, check=False)
    if result.returncode:
        raise RuntimeError("QQ_ENVIRONMENT_CHECK_FAILED")
    return result.stdout


def safe_container(info):
    host = info.get("HostConfig", {})
    env = dict(value.split("=", 1) for value in info["Config"].get("Env", []) if "=" in value)
    names = ["NAPCAT_DISABLE_MULTI_PROCESS", "NAPCAT_DISABLE_BYPASS", "NAPCAT_DISABLE_PIPE",
             "LD_PRELOAD", "LD_LIBRARY_PATH", "HOME", "NAPCAT_WORKDIR", "NAPCAT_QQ_DATA_DIR"]
    state = info.get("State", {})
    return {
        "imageId": info.get("Image"),
        "status": state.get("Status"), "startedAt": state.get("StartedAt"),
        "restarts": info.get("RestartCount"), "exitCode": state.get("ExitCode"),
        "oomKilled": state.get("OOMKilled"),
        "memory": host.get("Memory"), "nanoCpus": host.get("NanoCpus"),
        "cpuQuota": host.get("CpuQuota"), "cpuPeriod": host.get("CpuPeriod"),
        "readOnly": host.get("ReadonlyRootfs"), "init": host.get("Init"),
        "restartPolicy": host.get("RestartPolicy", {}).get("Name"),
        "tmpfs": host.get("Tmpfs"), "ulimits": host.get("Ulimits"),
        "securityOpt": host.get("SecurityOpt"), "capDrop": host.get("CapDrop"),
        "runtimeFlags": {name: env[name] for name in names if name in env},
        "mounts": [{"destination": value.get("Destination"), "rw": value.get("RW"),
                    "type": value.get("Type")} for value in info.get("Mounts", [])],
    }


COMPONENTS = r"""
const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
const out={node:process.version,arch:process.arch,kernel:os.release(),
 libc:process.report.getReport().header.glibcVersionRuntime,components:{}};
for(const [name,file]of [['qq','/opt/qq/package.json'],['napcat','/opt/napcat/package.json']]){
 try{out[name]=JSON.parse(fs.readFileSync(file)).version;}catch{out[name]=null;}
}
for(const file of ['/opt/node_addon.node','/opt/qq/wrapper.node',
 '/opt/qq/sharp-lib/libvips-cpp.so.42',
 '/opt/napcat/native/napi2native/napi2native.linux.x64.node',
 '/opt/napcat/native/packet/MoeHoo.linux.x64.node']){
 try{out.components[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
 catch{out.components[file]=null;}
}
console.log(JSON.stringify(out));
"""


def main():
    ids = capture(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=mooyu-qq",
                   "--filter", "label=com.docker.compose.service=napcat"]).split()
    containers = []
    for cid in ids:
        info = json.loads(capture(["docker", "inspect", cid]))[0]
        labels = info["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.oneoff", "false").lower() != "true":
            containers.append(info)
    if len(containers) != 1:
        raise RuntimeError("QQ_CONTAINER_COUNT_UNEXPECTED")
    info = containers[0]
    image = json.loads(capture(["docker", "image", "inspect", info["Image"]]))[0]
    cpu_flags = []
    cpu = Path("/proc/cpuinfo")
    if cpu.is_file():
        words = set(cpu.read_text().split())
        cpu_flags = [flag for flag in ["sse4_2", "avx", "avx2", "aes", "neon", "asimd"] if flag in words]
    report = {"at": datetime.now(timezone.utc).isoformat(),
              "host": {"machine": platform.machine(), "kernel": platform.release(), "cpuFlags": cpu_flags},
              "imagePlatform": image["Os"] + "/" + image["Architecture"],
              "gateway": safe_container(info),
              "components": json.loads(capture(["docker", "exec", info["Id"], "node", "-e", COMPONENTS])),
              "serviceChanged": False, "qrRefreshed": False, "credentialsIncluded": False}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("QQ_ENVIRONMENT_CHECK_FAILED; no service or login data was changed.")
