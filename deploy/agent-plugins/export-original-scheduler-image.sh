#!/usr/bin/env bash
# Requires explicit authorization to CREATE a private server-side export.
# Reads one immutable image only; never exports a container, env file or volume.
set -euo pipefail
umask 077
expected_image=sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843
source_container=gamehub-production-agent-blog-public-scheduler-1
backup_root=/www/backup/gamehub
for tool in docker tar sha256sum awk df mktemp nice chmod mv wc; do
  command -v "$tool" >/dev/null || { echo EXPORT_TOOL_MISSING >&2; exit 2; }
done
test -d "$backup_root" || { echo BACKUP_ROOT_MISSING >&2; exit 2; }
actual=$(docker inspect --format '{{.Image}}' "$source_container")
test "$actual" = "$expected_image" || { echo ORIGINAL_IMAGE_CHANGED >&2; exit 2; }
image_bytes=$(docker image inspect --format '{{.Size}}' "$expected_image")
free_kb=$(df -Pk -- "$backup_root" | awk 'NR==2 {print $4}')
[[ "$image_bytes" =~ ^[0-9]+$ && "$free_kb" =~ ^[0-9]+$ ]] || {
  echo DISK_OR_IMAGE_SIZE_UNKNOWN >&2; exit 2;
}
required_kb=$(( (image_bytes * 2 + 1073741824 + 1023) / 1024 ))
(( free_kb >= required_kb )) || { echo EXPORT_DISK_SPACE_LOW >&2; exit 2; }

record=$(mktemp -d "$backup_root/scheduler-image-ee818f213525-XXXXXXXX")
chmod 700 "$record"
archive="$record/original-scheduler-ee818f213525.tar"
partial="$archive.partial"
printf 'Exporting immutable image to private directory: %s\n' "$record"
nice -n 10 docker image save --output "$partial" "$expected_image"
chmod 600 "$partial"

# Confirm this export retained the original OCI root, not merely a shared
# attestation config or the runnable platform's different config digest.
digest=${expected_image#sha256:}
root_hash=$(tar -xOf "$partial" "blobs/sha256/$digest" | sha256sum | awk '{print $1}')
test "$root_hash" = "$digest" || { echo ORIGINAL_OCI_ROOT_NOT_RETAINED >&2; exit 2; }
tar -tf "$partial" >/dev/null
actual=$(docker inspect --format '{{.Image}}' "$source_container")
test "$actual" = "$expected_image" || { echo SCENE_CHANGED_EXPORT_RETAINED >&2; exit 2; }
archive_hash=$(sha256sum "$partial" | awk '{print $1}')
test ! -e "$archive"
mv -- "$partial" "$archive"
printf '%s  original-scheduler-ee818f213525.tar\n' "$archive_hash" > "$archive.sha256"
chmod 600 "$archive.sha256"
printf 'Image: %s\nArchive: %s\nChecksum: %s.sha256\nSHA256: %s\nBytes: %s\n' \
  "$expected_image" "$archive" "$archive" "$archive_hash" "$(wc -c < "$archive")"
# Failure retains this newly created partial file for inspection. Never deletes
# old backups or invokes stop/start/restart/update/up/load/pull/push/down/restore.
