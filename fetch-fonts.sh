#!/usr/bin/env bash
set -euo pipefail

# Script to fetch woff2 font files used by the project and store them in /fonts
# Usage: ./fetch-fonts.sh

CSS_URL="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Playfair+Display:wght@400&display=swap"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
OUTDIR="fonts"
TMPCSS="/tmp/bundesliga_fonts.css"

mkdir -p "$OUTDIR"

echo "Fetching CSS from Google Fonts..."
curl -s -A "$UA" "$CSS_URL" -o "$TMPCSS"

if [ ! -s "$TMPCSS" ]; then
  echo "Failed to download CSS. Check network or User-Agent." >&2
  exit 1
fi

# Extract unique font URLs (fonts.gstatic.com) and download them
grep -o 'https://fonts.gstatic.com/[^)"\']*' "$TMPCSS" | sort -u | while read -r url; do
  fname=$(basename "$url")
  # Prefer .woff2 files; skip if already downloaded
  if [ -f "$OUTDIR/$fname" ]; then
    echo "Already have $fname, skipping."
    continue
  fi
  echo "Downloading $fname..."
  curl -L -o "$OUTDIR/$fname" "$url"
  if [ $? -ne 0 ]; then
    echo "Failed to download $url" >&2
  fi
done

echo "Done. Fonts placed in $OUTDIR. Review licenses and commit the files if desired."