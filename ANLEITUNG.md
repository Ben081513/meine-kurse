# Meine Kurse: so kommt die App aufs iPhone

Diese Anleitung erklärt, wie die Kursplan-App bei GitHub ins Netz kommt und sich danach jede Stunde selbst aktualisiert. **Noch ist nichts veröffentlicht.** Erst wenn du die Schritte unten machst, ist die App im Internet erreichbar.

Gut zu wissen, bevor du anfängst:

- **Öffentlich:** Das Repository muss *öffentlich* sein. Nur dann ist die stündliche Aktualisierung kostenlos, denn sie braucht einen Mac-Rechner bei GitHub (die Texterkennung gibt es nur auf dem Mac). Öffentlich heißt: Jeder mit dem Link kann die App und die Kurspläne sehen. Deine Auswahl (Studios, Kurse, Zeiten) bleibt trotzdem nur auf deinem iPhone gespeichert.
- **Dauer:** etwa 15 Minuten.
- **Du brauchst:** einen kostenlosen GitHub-Zugang (github.com → „Sign up“).

---

## 1. Repository anlegen

1. Auf github.com anmelden, oben rechts auf **+** → **New repository**.
2. **Repository name:** zum Beispiel `meine-kurse`. Der Name steht später in der Adresse der App.
3. **Public** auswählen.
4. Alles andere leer lassen und **Create repository** drücken.

## 2. Dateien hochladen

1. Im neuen, leeren Repository auf **uploading an existing file** klicken.
2. Aus dem Ordner `superfit` diese Ordner und Dateien ins Fenster ziehen:
   - `site`
   - `scraper`
   - `data` (darin genügt `sources.json`; die Ordner `pdfs` und `bin` werden nicht gebraucht)
   - `tests`
   - `.github` (versteckter Ordner: im Finder mit **Cmd + Shift + Punkt** sichtbar machen)
   - `.gitignore`, `ANLEITUNG.md`
3. Unten auf **Commit changes** drücken.

Prüfen: Im Repository sollte jetzt der Ordner `.github/workflows` mit der Datei `update.yml` zu sehen sein. Fehlt er, Schritt 2 für den Ordner `.github` wiederholen.

## 3. GitHub Pages einschalten

1. Im Repository oben auf **Settings**, links auf **Pages**.
2. Bei **Source** die Option **GitHub Actions** wählen. (Nicht „Deploy from a branch“.)

## 4. Ersten Lauf starten

1. Oben auf **Actions**. Falls GitHub fragt, ob Abläufe erlaubt sind: bestätigen. Ein rot markierter Lauf vom Hochladen in Schritt 2 ist normal: Da war Pages noch nicht eingeschaltet.
2. Links **Kursplan aktualisieren** wählen, rechts **Run workflow** → **Run workflow**.
3. Nach ein paar Minuten haben beide Schritte („update“ und „deploy“) einen grünen Haken.
4. Im Schritt **deploy** steht die Adresse der App, etwa
   `https://DEIN-NAME.github.io/meine-kurse/`

Ab jetzt läuft die Aktualisierung von selbst jede Stunde. Sie speichert nur dann etwas, wenn Superfit wirklich einen neuen Plan veröffentlicht hat.

## 5. Auf den Home-Bildschirm legen

1. Die Adresse aus Schritt 4 auf dem iPhone in **Safari** öffnen.
2. Unten auf das **Teilen-Symbol** (Quadrat mit Pfeil nach oben) tippen.
3. **Zum Home-Bildschirm** wählen, **Hinzufügen** tippen.
4. Die App **vom Home-Bildschirm aus** öffnen und dort deine Studios, Kurse und Zeiten einstellen. (Das iPhone speichert die Auswahl der Home-Bildschirm-App getrennt von Safari. Was du in Safari einstellst, kommt dort nicht an.)

---

## Wenn etwas nicht klappt

- **E-Mail von GitHub „Run failed“:** Ein Kursplan konnte nicht gelesen werden, oft weil Superfit das PDF anders gestaltet hat. Die App zeigt für dieses Studio weiter den alten Plan. Unter **Actions** → letzter Lauf → **update** → „Kurspläne einlesen“ stehen Zeilen mit **FEHLER**, die genau sagen, welcher Plan betroffen ist.
- **Die App zeigt einen alten Stand:** App einmal ganz schließen und neu öffnen. Ganz oben steht, ab wann der Plan gilt.
- **Die Aktualisierung hat aufgehört:** GitHub hält stündliche Abläufe an, wenn in einem Repository 60 Tage lang nichts geändert wurde. Dann unter **Actions** → **Kursplan aktualisieren** auf **Enable workflow** drücken.
- **Änderungen an der App selbst** (Dateien im Ordner `site`): Nach dem Hochladen wird die App automatisch neu veröffentlicht.
