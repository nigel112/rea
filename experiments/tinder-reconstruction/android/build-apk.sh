#!/usr/bin/env bash
# Build the reconstruction APK without Gradle.
#
# Uses the Android SDK command-line tools directly (aapt2, javac, d8, zipalign,
# apksigner). That keeps the build to one Java file with no dependency
# resolution, so it works on a stock GitHub runner with no network beyond the
# checkout.
#
# Usage: bash android/build-apk.sh
# Requires: JAVA_HOME (JDK 17+) and ANDROID_HOME/ANDROID_SDK_ROOT with
#           build-tools 34+ and one platform.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPERIMENT="$(dirname "$HERE")"
BUILD="$HERE/build"
DIST="$HERE/dist"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$SDK" || ! -d "$SDK" ]]; then
  echo "ANDROID_HOME is not set; cannot find the SDK" >&2
  exit 1
fi

pick_latest() { ls -d "$1"/* 2>/dev/null | sort -V | tail -1; }
BUILD_TOOLS="$(pick_latest "$SDK/build-tools")"
PLATFORM="$(pick_latest "$SDK/platforms")"
if [[ -z "$BUILD_TOOLS" || -z "$PLATFORM" ]]; then
  echo "build-tools or platform missing under $SDK" >&2
  exit 1
fi

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
ANDROID_JAR="$PLATFORM/android.jar"

echo "build-tools: $BUILD_TOOLS"
echo "platform:    $PLATFORM"
java -version 2>&1 | head -2

# 1. Bundle the web assets (idempotent; also run by CI before this script).
node "$HERE/stage.mjs"

rm -rf "$BUILD/apk" "$BUILD/classes" "$BUILD/dex"
mkdir -p "$BUILD/apk" "$BUILD/classes" "$BUILD/dex" "$DIST"

echo "== aapt2 link"
"$AAPT2" link \
  -o "$BUILD/apk/unsigned.apk" \
  --manifest "$HERE/app/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  -A "$BUILD/www" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 1 \
  --version-name "1.0" \
  --auto-add-overlay

echo "== javac"
find "$HERE/app/src" -name '*.java' > "$BUILD/sources.txt"
javac -source 11 -target 11 -Xlint:-options \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

echo "== d8"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$D8" --lib "$ANDROID_JAR" --min-api 24 --output "$BUILD/dex" @"$BUILD/classes.txt"

echo "== package dex"
cp "$BUILD/apk/unsigned.apk" "$BUILD/apk/app.apk"
(cd "$BUILD/dex" && zip -q -X "$BUILD/apk/app.apk" classes.dex)

echo "== zipalign"
"$ZIPALIGN" -f 4 "$BUILD/apk/app.apk" "$BUILD/apk/app-aligned.apk"

echo "== sign (debug key, generated per build)"
KEYSTORE="$BUILD/debug.keystore"
rm -f "$KEYSTORE"
keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -storepass android -keypass android \
  -alias androiddebugkey \
  -dname "CN=Android Debug,O=Android,C=US" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  >/dev/null 2>&1

OUT="$DIST/rea-tinder-reconstruction.apk"
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$OUT" \
  "$BUILD/apk/app-aligned.apk"

echo "== verify"
"$APKSIGNER" verify --verbose --print-certs "$OUT" | head -12
"$AAPT2" dump badging "$OUT" | head -6

SIZE=$(stat -c%s "$OUT")
echo "built $OUT (${SIZE} bytes)"
