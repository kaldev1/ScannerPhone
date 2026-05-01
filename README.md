# ScannerPhone

A self-contained document scanner web app for Android phones and desktop browsers.

## Features

- Uses the phone camera through browser camera access when available.
- Falls back to Android's camera capture when live preview is not available.
- Keeps gallery/photo selection separate from camera capture.
- Applies scan-style cleanup with document, grayscale, color, or original modes.
- Optional automatic edge crop.
- Saves scanned pages as JPG files.
- Saves one or many scanned pages into a single PDF.
- Can run offline after being opened from a local web server.

## Run

Open `index.html` directly in a browser, or serve the folder locally:

```powershell
cd C:\apps\ScannerPhone
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Live camera preview requires a secure browser context. `localhost` is allowed on the same device. If the app is opened from a file or another non-secure page, the Open Camera button uses Android's native camera capture instead of the live preview. Add Photos opens the gallery/file picker.
