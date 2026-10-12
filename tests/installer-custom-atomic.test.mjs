import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const installer = readFileSync(join(root, "install.sh"), "utf8");
const functions = installer.slice(installer.indexOf("get_fragment_markers()"), installer.indexOf("merge_radio_custom_js_source()"));

function run(body) {
  const dir = mkdtempSync(join(tmpdir(), "homepage-custom-atomic-"));
  try {
    const result = spawnSync("bash", ["-c", `set -Eeuo pipefail\nlog() { :; }\ndie() { exit 1; }\n${functions}\n${body}`, "test", dir, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("custom upsert preserves unmanaged content, every preset, modes and symlink referents", () => run(`
  cd "$1"
  mkdir config real
  printf '/* user title */\n' > real/custom.css
  chmod 640 real/custom.css
  ln -s ../real/custom.css config/custom.css
  exec 3< real/custom.css
  old_inode="$(stat -c %i real/custom.css)"
  for preset in cards extras radio particles; do
    for kind in css js; do
      source="$2/custom-config/$preset/custom.$kind"
      if [[ -f "$source" ]]; then
        upsert_fragment "$source" "config/custom.$kind"
      fi
    done
  done
  [[ -L config/custom.css ]]
  [[ "$(stat -c %a real/custom.css)" == 640 ]]
  [[ "$(stat -c %i real/custom.css)" != "$old_inode" ]]
  [[ "$(cat <&3)" == '/* user title */' ]]
  grep -Fq '/* user title */' real/custom.css
  cp real/custom.css expected.css
  cp config/custom.js expected.js
  for preset in cards extras radio particles; do
    for kind in css js; do
      source="$2/custom-config/$preset/custom.$kind"
      if [[ -f "$source" ]]; then
        upsert_fragment "$source" "config/custom.$kind"
        start="$(grep -m1 'HOMEPAGE-EDITOR .* START' "$source")"
        [[ "$(grep -Fxc "$start" "config/custom.$kind")" == 1 ]]
      fi
    done
  done
  cmp expected.css real/custom.css
  cmp expected.js config/custom.js
  umask 027
  printf 'new\n' > source
  atomic_replace_custom_file source config/new.js
  [[ "$(stat -c %a config/new.js)" == 640 ]]
  ln -s ../real/missing.js config/missing.js
  atomic_replace_custom_file source config/missing.js
  [[ -L config/missing.js ]]
  cmp source real/missing.js
`));

test("failed custom writes leave original bytes and no staging files", () => run(`
  cd "$1"
  mkdir config scratch
  export TMPDIR="$1/scratch"
  printf 'original\n' > config/custom.css
  cp config/custom.css expected
  mv() { return 1; }
  if atomic_replace_custom_file expected config/custom.css; then exit 1; fi
  cmp expected config/custom.css
  if upsert_fragment "$2/custom-config/cards/custom.css" config/custom.css; then exit 1; fi
  cmp expected config/custom.css
  unset -f mv
  chmod() { return 1; }
  if atomic_replace_custom_file expected config/custom.css; then exit 1; fi
  unset -f chmod
  if atomic_replace_custom_file missing-source config/custom.css; then exit 1; fi
  cmp expected config/custom.css
  shopt -s nullglob dotglob
  stages=(config/.homepage-custom.* scratch/*)
  [[ "\${#stages[@]}" == 0 ]]
`));

test("legacy cleanup preserves unrelated content and rejects incomplete fragments", () => run(`
  cd "$1"
  printf 'before\n.service-card,\n[id^="color-test"] {}\n/* --- STATUS & PING BADGE POSITIONING --- */\nafter\n' > custom.css
  chmod 604 custom.css
  remove_legacy_color_cards_css custom.css
  [[ "$(stat -c %a custom.css)" == 604 ]]
  grep -Fxq before custom.css
  grep -Fxq after custom.css
  ! grep -Fq '.service-card,' custom.css
  [[ -f custom.css.bak ]]
  printf 'before\n/* --- TAB NAVIGATION --- */\nold\n/* >>> HOMEPAGE-EDITOR COLOR CARDS CSS START >>> */\nafter\n' > extras.css
  remove_legacy_custom_extras_css extras.css
  ! grep -Fxq old extras.css
  grep -Fxq before extras.css
  grep -Fxq after extras.css
  printf 'before\nSTART OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON\nold\nEND OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON\nafter\n' > particles.js
  remove_legacy_particles_fragment particles.js
  ! grep -Fxq old particles.js
  grep -Fxq before particles.js
  grep -Fxq after particles.js
  printf '(function homepageRadioWidget() {\nold\n})();\nafter\n' > radio.js
  remove_legacy_radio_js radio.js
  [[ "$(<radio.js)" == after ]]
  printf 'before\nSTART OF OLD /srv/start TRANSFER: INTERACTIVE BACKGROUND + FPS BUTTON\nold\n' > incomplete.js
  cp incomplete.js expected
  remove_legacy_particles_fragment incomplete.js
  cmp expected incomplete.js
`));
