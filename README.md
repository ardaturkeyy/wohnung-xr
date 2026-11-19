# Wohnung XR

Eine WebXR-App (three.js, ohne Build-Schritt), mit der du in einer VR-Brille durch einen 3D-Scan deiner echten Wohnung läufst: im Massstab 1:1 und auf Wunsch genau an den echten Wänden ausgerichtet.

- **VR-Modus:** physisch herumlaufen, Teleport mit dem Trigger, Gleiten mit dem linken Stick, Drehen mit dem rechten Stick
- **Passthrough-Modus (AR):** der Scan liegt halbtransparent über der echten Wohnung. So prüfst du die Ausrichtung.
- **Desktop-Modus:** WASD und Maus zum Testen am PC
- **Handy-Version ([handy.html](handy.html)):** mit dem Touch-Joystick durch die Wohnung laufen, ganz ohne Brille
- Solange kein Scan da ist, zeigt die App Wohnzimmer und Küche, nachgebaut aus Fotos ([apartment.js](apartment.js)). Die Masse sind geschätzt. Für das Laufen im Massstab 1:1 trägst du oben im Objekt `M` deine gemessenen Werte ein.

## 1. Wohnung scannen

Du brauchst ein 3D-Modell als **GLB** im Massstab Meter. Diese Apps funktionieren gut:

| App | Gerät | Export |
|---|---|---|
| **Polycam** | iPhone/iPad mit LiDAR (am besten), sonst Fotomodus | GLB |
| **Scaniverse** | iPhone, Android | GLB |
| **Matterport** | Kamera/Smartphone | OBJ, in Blender zu GLB umwandeln |

Tipps:
- Raum für Raum langsam scannen, auch Türdurchgänge mitnehmen, damit alles ein zusammenhängendes Modell ergibt.
- Die Datei sollte unter ca. 50 MB bleiben (GitHub erlaubt höchstens 100 MB pro Datei). In Polycam beim Export eine mittlere Qualität wählen oder in Blender mit dem *Decimate*-Modifier verkleinern.

## 2. Modell einbinden

Lege die Datei als `models/wohnung.glb` ab. Alternativ:
- Button **„GLB laden"** bzw. Drag & Drop: lädt die Datei nur lokal im Browser, ohne Upload.
- URL-Parameter: `index.html?model=models/anderer-scan.glb`

> ⚠️ **Privatsphäre:** Ist das Repository öffentlich, kann jeder den Scan deiner Wohnung herunterladen. Wenn du das nicht willst, committe die GLB-Datei nicht (trage `models/*.glb` in `.gitignore` ein) und lade sie in der Brille über **„GLB laden"**. Der Quest-Browser kann Dateien aus dem Download-Ordner öffnen.

## 3. Startpunkt festlegen (für 1:1 in der echten Wohnung)

Damit sich Modell und echte Wohnung decken, gibt es einen **Startpunkt**, z. B. direkt hinter der Wohnungstür mit Blick in den Flur.

1. Öffne die Seite am PC, klicke ins Bild und laufe mit WASD an diese Stelle. Schau in die gewünschte Richtung.
2. Drücke **P**. Die Zeile `spawn: { x: …, z: …, yaw: … }` wird in die Zwischenablage kopiert.
3. Trage sie in `main.js` bei `CONFIG` ein (statt `spawn: null`).

In der Brille:
1. Stell dich an die echte Stelle und schau in dieselbe Richtung.
2. Starte VR. Das Modell wird automatisch dort ausgerichtet.
3. Zum Nachjustieren: wieder an den Startpunkt stellen und die **Grip-Taste** drücken.

Mit **Passthrough (AR)** siehst du, ob die Wände übereinanderliegen.

## 4. Auf GitHub veröffentlichen (GitHub Pages)

WebXR funktioniert nur über **HTTPS**. GitHub Pages stellt das kostenlos bereit.

1. Auf github.com ein neues Repository anlegen, z. B. `wohnung-xr` (ohne README).
2. Im Projektordner:
   ```powershell
   git remote add origin https://github.com/<DEIN-NAME>/wohnung-xr.git
   git push -u origin main
   ```
3. Im Repository unter **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, Ordner `/ (root)` → **Save**.
4. Nach ca. 1 Minute ist die App erreichbar unter `https://<DEIN-NAME>.github.io/wohnung-xr/`.
5. Diese URL im Browser der Meta Quest (oder einer anderen WebXR-Brille) öffnen und auf **VR starten** tippen.

## Lokal testen

```powershell
python -m http.server 8000
```
Dann `http://localhost:8000` öffnen. Zum Testen von VR am PC eignet sich die Browser-Erweiterung *Immersive Web Emulator* (Meta).

## Handy-Version

Öffne `https://<DEIN-NAME>.github.io/wohnung-xr/handy.html` auf dem Handy (oder tippe auf der Startseite auf **📱 Handy-Version**).

- **Linke Bildschirmhälfte:** Daumen auflegen und ziehen. Der Joystick erscheint dort, wo du hintippst. Je weiter du ziehst, desto schneller läufst du.
- **Rechte Bildschirmhälfte:** wischen zum Umsehen (links/rechts und hoch/runter)
- **Menü ☰:**
  - *Wände blockieren*: Kollision an/aus. Ausgeschaltet läufst du durch Wände und Möbel.
  - *Umsehen mit Neigen*: Blickrichtung folgt dem Lagesensor des Handys. Das iPhone fragt dabei nach der Erlaubnis.
  - *Tempo* (langsam/normal/schnell), *Zurück zum Start*, *GLB-Scan laden*
- **⛶** = Vollbild (nicht auf dem iPhone. Dort über *Teilen → Zum Home-Bildschirm* als App öffnen.)
- Am PC zum Testen: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> laufen, <kbd>Q</kbd>/<kbd>E</kbd> drehen

## Anpassen

Alle Einstellungen stehen oben in `main.js` im Objekt `CONFIG`: Modellpfad, Startpunkt, Gehgeschwindigkeit und Drehwinkel.

## Bekannte Grenzen

- Am Desktop und beim Gleiten in VR gibt es keine Kollision mit Wänden (in der Handy-Version schon).
- Die Kalibrierung gilt nur pro VR-Session. Nach jedem Start einmal am Startpunkt stehen oder die Grip-Taste drücken.
- Sehr grosse Scans (über 1 Mio. Dreiecke) können auf der Quest ruckeln. Dann das Modell verkleinern.
