# Spezifikation: Clients, Tonquellen und Gerätemodus

Gilt mit ADR 0010. Begriffe aus `CONTEXT.md`: Client, Input, Session, Setting, Device Mode, Channel Capture, Card, History.

## 1. Clients und Reihenfolge

| Client | Technik | Inkrement | Plattformen | Was nur er kann |
|---|---|---|---|---|
| Web-App | React, eine Codebasis, AudioWorklet mit Resampling auf 16 kHz (aus dem alten Repo), WebSocket nach dem Live-Vertrag | 1 | iPhone im Safari-Tab (Bildschirm an), Android in Chrome, Desktop in Chrome, Edge, Safari, Firefox | Tab-Audio am Desktop; Datei-Upload nach dem Launch |
| Store-Apps iOS und Android | Capacitor-Hülle um dieselbe Web-App; eigene Plugins in Swift und Kotlin nur für Foreground Service, Playback Capture, Hintergrundaudio, später Spracherkennung auf dem Gerät | 2 | iOS 17+, Android 10+ | Hintergrundaufnahme bei Sperre und App-Wechsel, Playback Capture (Android), Opus, Abo im Store, später Gerätemodus |
| Server-Ingestion | kopfloser Client des Live-Vertrags: ffmpeg dekodiert den Strom eines Partners (HLS, SRT, RTMP) zu PCM16 oder Opus; Dienstanmeldung | später, mit dem ersten Partner | Betreiber | Session ohne verbundenen Client (Nebel) |
| Desktop nativ | nicht geplant; Nebel "Desktop nativ mit Systemton" (Tauri mit Core Audio Taps, WASAPI Loopback) | – | – | Systemton aus TV-Apps und HDMI |

Desktop ist der Browser. Es gibt keine Home-Screen-Installation als beworbenen Weg (Abschnitt 4).

## 2. Tonquellen je Plattform

Genau ein Input je Gespräch. Der Tonabgriff ersetzt das Mikrofon, es gibt keinen Mehrkanalbetrieb. Der Knopf "Tonabgriff wählen" im Dialog des Modus Sendung (Datenschutz-Spezifikation 1.1) zeigt je Plattform, was es gibt.

| Plattform | Mikrofon | Eingabegerät wählen (Line-In, USB vom TV-Ausgang) | Tab-Audio | Playback Capture | Inkrement |
|---|---|---|---|---|---|
| iPhone, Safari-Tab | ja | ja | nein | nein | 1 |
| Android, Chrome | ja | ja | nein | nein | 1 |
| Desktop, Chrome und Edge | ja | ja | ja (`getDisplayMedia` mit Audio; Mediathek im Nachbar-Tab; Windows auch Systemton) | nein | 1 |
| Desktop, Safari und Firefox | ja | ja | nein | nein | 1 |
| iOS-Store-App | ja | ja | nein | nein (Nebel "iOS-Tonabgriff": ScreenCaptureKit ab iOS 27 unbelegt) | 2 |
| Android-Store-App | ja | ja | nein | ja (AudioPlaybackCapture, Android 10+, MediaProjection-Dialog; Apps können opt-outen, Abschnitt 9) | 2 |

Mit Tab-Audio oder Playback Capture ist der Input `broadcast` über den Sendungston; der Dialogsatz zu den Anwesenden entfällt (Datenschutz-Spezifikation 1.1). Mit Mikrofon oder Eingabegerät gilt im Modus Sendung die Kurzform, Nebensprecher werden zurückgehalten und verworfen, wenn niemand sie zuordnet; die App fragt dafür am Label nach (ADR 0009, Nachträge 2026-10-27 und 2026-10-28).

## 3. Live-Vertrag aus Client-Sicht

- `audio.start` mit `encoding: pcm16` in der Web-App; `opus` (24 bis 32 kbit/s) in den Store-Apps, nativ kodiert. Frames nach `docs/spec/inputs.md`, Abschnitt 3.
- Die Web-App zeigt vor dem Start einen Hinweis auf das Datenvolumen (etwa 115 MB je Stunde), wenn sie Mobilfunk erkennt; wo der Browser das nicht meldet, steht der Hinweis in den Einstellungen.
- Pause (ADR 0009) sendet `audio.stop`; "Weiter" öffnet einen neuen Input in derselben Session. Dasselbe gilt nach einer Unterbrechung (Abschnitt 4).
- Anmeldung (ADR 0013): Web-App und Store-App melden sich bei Cognito mit Authorization Code und PKCE an, je Plattform mit einem eigenen öffentlichen App-Client ohne Secret. Das Access-Token (60 Minuten) liegt nur im Speicher. Das Refresh-Token rotiert und gilt in der Web-App 7 Tage (`localStorage`), in der Store-App 30 Tage (Keychain oder Keystore). "Abmelden" widerruft es bei Cognito.
- Der Client schickt das Access-Token als erste WebSocket-Nachricht, nie in der URL. Der Rand des Backends prüft die Origin im Handshake und bei jedem Verbindungsaufbau und jedem `audio.start` das Token und die Konto-Zeile (ADR 0013).
- Vor jedem Start zeigt der Client die Restminuten des Kontos. Sind sie aufgebraucht, kommt `audio.stopped` mit `quota_exceeded`: Die Session endet, und "Weiter" gibt es bis zum nächsten Abrechnungszeitraum nicht. Eine Warnung bei wenigen Restminuten ist eine Anforderung an den Live-Vertrag; Name und Form der Nachricht entscheidet das Frontend-Ticket (ADR 0013).

## 4. Bildschirmsperre, App-Wechsel, Unterbrechung

Web-App:

1. Beim Start fordert sie einen Wake Lock an und sagt es: "Der Bildschirm bleibt an, solange mitgehört wird."
2. Sie bewirbt keine Home-Screen-Installation und zeigt keinen Install-Hinweis. Läuft sie doch installiert (Standalone-Modus), zeigt sie vor dem Start "Im Browser öffnen", weil die Home-Screen-Web-App auf iOS das Mikrofon bei Sperre und App-Wechsel verliert.
3. Verliert sie das Mikrofon (`visibilitychange` nach hidden, Track `ended` oder `mute`, `AudioContext` `interrupted`), sendet sie `audio.stop`, zeigt "Aufnahme unterbrochen" und bietet "Weiter" an.
4. Ein Reconnect des WebSockets beendet den Input, nicht die Session; "Weiter" wie oben.

Store-Apps: Hintergrundaufnahme bei Sperre und App-Wechsel ist Ziel. iOS über `UIBackgroundModes audio` im WKWebView, falls der Gerätetest (Abschnitt 9) es bestätigt, sonst über ein natives Capture-Plugin; Android über einen Foreground Service vom Typ `microphone`, gestartet im Vordergrund, mit Benachrichtigung. Ein eingehender Anruf beendet den Input auf beiden Plattformen; die App zeigt "Aufnahme unterbrochen".

## 5. Pflichtelemente in jedem Client

| Element | Regel | Quelle |
|---|---|---|
| Setting | Modus Pflicht, Sprecher mit Rolle und "öffentlich", Anfangs-Topic; Vorlagen aus dem Gerät (Abschnitt 6) | ADR 0007 |
| Dialog je Modus | vor dem ersten Audio, Text und Version aus dem Backend, Anbieterliste aus der Konfiguration; ohne Bestätigung kein Input | ADR 0009, Datenschutz 1.1 |
| Ansage | Schalter im Dialog; der Client spielt eine feste Audiodatei, die das Backend je `dialogVersion` ausliefert; ob sie lief, meldet der Client für den Consent Record | ADR 0009, ADR 0010 |
| Tonabgriff wählen | Menü je Plattform nach Abschnitt 2 | ADR 0010 |
| Aufnahmeanzeige | dauerhaft sichtbar, solange ein Input offen ist | ADR 0009 |
| Pause, Weiter | Abschnitt 3 | ADR 0009 |
| Sprecher ausnehmen | am Label der Karte oder des Transkripts | ADR 0009 |
| Rückfrage "Sprecher B: wer ist das?" | nur Modus Sendung über Mikrofon oder Eingabegerät, solange Segmente eines Labels zurückgehalten werden; Auswahl Namen aus dem Setting und "Niemand aus der Sendung / ausnehmen"; Regeln in der Spezifikation Sprecher, Abschnitt 8 | ADR 0009 (Nachtrag 2026-10-28), ADR 0008 |
| Karten, Transkript, Topic-Zeitleiste | Gestaltung in der Live-Ansicht (#16); Karte mit Quellen-Plakette, "sinngemäß", Wortlaut, Kennzeichnung "automatisch erzeugt" | ADR 0007, 0008, 0009 |
| Verlauf behalten | Schalter je Gespräch, auch nachträglich innerhalb der 15 Minuten | ADR 0009 |
| Gerät oder Cloud | nur sichtbar, wenn der Client den Gerätemodus hat (Abschnitt 11); sonst nicht gezeigt | ADR 0010 |

## 6. Was auf dem Gerät liegt

- Anmeldung (Token-Modell aus #13 und #22).
- Einstellungen: Modus-Voreinstellung, Eingabegerät, Ansage an oder aus, Volumenhinweis gesehen.
- Setting-Vorlagen: benannte Sprecher mit Rolle und "öffentlich", auch private Namen ("Mama", "Papa"); nur lokal, in den Einstellungen löschbar, nie zum Konto. Beim Start eines Gesprächs geht die gewählte Vorlage als Setting an das Backend wie eine Eingabe von Hand.
- Nichts sonst: keine Karten, kein Transkript, kein Verlauf. Der Verlauf liegt im Konto (Datenschutz-Spezifikation 3) und zeigt für private Sprecher das Label.

## 7. Mindestversionen

| Client | Mindestens | Grund |
|---|---|---|
| Web-App iPhone | Safari 17 | Wake Lock (16.4), AudioWorklet (14.1), WebSocket, stabile Mikrofonfreigabe |
| Web-App Android, Desktop | Chrome und Edge der letzten zwei Jahre; Safari 17; Firefox aktuell, nur Mikrofon und Eingabegerät | Tab-Audio braucht Chrome oder Edge |
| iOS-Store-App | iOS 17 | Hintergrundaudio im WKWebView ab 17.5 berichtet (verify) |
| Android-Store-App | Android 10 (API 29) | AudioPlaybackCapture; Foreground-Service-Typ `microphone` ab Android 14 Pflicht |
| Gerätemodus (später) | iOS 26 (SpeechAnalyzer), Android nach Messung | Research #38 |

## 8. Store-Checkliste (Inkrement 2)

Konservativ deklarieren (ADR 0009); Lockerungen nur mit dem Anwalt (#42).

- Apple: `NSMicrophoneUsageDescription`; 2.5.14 Aufnahmeanzeige (Abschnitt 5); 5.1.1 Privacy-Policy-Link in App und App Store Connect; 5.1.2(i) Weitergabe an Dritt-KI im Dialog benannt; Nutrition Label: Audio Data und User Content, Deepgram und AWS als Dienstleister, Brave, Google, Wikimedia als Dritte; `UIBackgroundModes audio` mit Review-Notiz "Mithören eines laufenden Gesprächs bei gesperrtem Bildschirm"; Abo als In-App-Abo (Konten #13); Small Business Program.
- Google: `RECORD_AUDIO` zur Laufzeit; Prominent Disclosure im Dialog; Privacy Policy in Play Console und App; Data Safety: Voice or sound recordings, geteilt mit Dienstleistern; `FOREGROUND_SERVICE_MICROPHONE` im Manifest und in der Play Console mit Funktionsbeschreibung und Demo-Video; MediaProjection-Dialog für Playback Capture; Developer Verification (2027 weltweit).
- Beide: Aufnahmeanzeige, Datenschutzinformation für Gesprächsteilnehmer verlinkt (Datenschutz-Spezifikation 9).

## 9. Gerätetests vor dem Store-Inkrement

Belege aus Foren und Quellcode, auf dem Gerät zu bestätigen; Ergebnis in `docs/testing/` des privaten Repos.

1. iPhone: Safari-Tab und Capacitor mit `UIBackgroundModes audio`, je bei App-Wechsel und Bildschirmsperre; Entscheidung: natives Capture-Plugin oder nicht.
2. Android: Chrome-Capture bei Sperre und Doze; Foreground Service der Store-App bei Sperre; eingehender Anruf.
3. ARD- und ZDF-Mediathek-Apps gegen AudioPlaybackCapture (`allowAudioPlaybackCapture`); Ergebnis bestimmt, ob "Tonabgriff wählen" auf Android die Mediatheken nennt.
4. Vor dem Gerätemodus (später): `SpeechTranscriber.supportedLocales` auf iOS 26 enthält Deutsch; Diarisierung (FluidAudio, sherpa-onnx) mit DER und RTF auf deutschen Debatten; Akku über 90 Minuten.

## 10. Server-Ingestion (später)

- Ein vom Betreiber gestarteter Prozess spricht den Live-Vertrag (Abschnitt 3) mit Dienstanmeldung; ffmpeg dekodiert den vom Partner bereitgestellten Strom (HLS, SRT, RTMP) zu `pcm16` oder `opus`.
- Das Backend hat keinen URL-Input (ADR 0005); der Strom wird vom Partner lizenziert bereitgestellt, nie von einer Mediathek geholt.
- Offen bis zum ersten Partner: Session ohne verbundenen Client mit Karten für später dazukommende Zuschauer (Betriebsmodell #15), Setting aus Programmdaten (Sprecher-Spezifikation 7).

## 11. Gerätemodus (Device Mode)

- Definition: Spracherkennung und Diarisierung laufen auf dem Gerät; der Client sendet finale Segmente nach dem Segment-Vertrag (`docs/spec/inputs.md`, Abschnitt 4) an das Backend; Setting, Erkennung, Prüfung und Karten laufen wie sonst. Versprechen genau ein Satz: "Dein Ton verlässt das Gerät nicht" (ADR 0009).
- Spracherkennung ohne Diarisierung ist kein Gerätemodus: Turn-Bildung (ADR 0002) und das Verwerfen der Nebensprecher im Modus Sendung (ADR 0009) brauchen Sprecherlabels.
- Die Einstellung "Gerät oder Cloud" erscheint nur in einem Client, der den Gerätemodus hat; im ersten und zweiten Inkrement nur Cloud.
- Zeitpunkt: nach den Store-Apps, als eigenes Ticket mit Messung auf dem Gerät (Abschnitt 9, Punkt 4); Kandidaten iOS 26 SpeechAnalyzer plus FluidAudio, Android System-STT oder Parakeet plus sherpa-onnx, je als eigenes Capacitor-Plugin. Ein voller Gerätemodus mit Extraktion ist nicht Ziel (Research #38).
- Mit dem Gerätemodus wird der Segment-Vertrag öffentlich; bis dahin darf er sich ohne Vertragsänderung bewegen.

## 12. Datei-Upload nach dem Launch

- Nur Web-App, nur `mode: conversation`, Dialog nach ADR 0009 plus Bestätigung "Diese Aufnahme ist mit Einwilligung aller entstanden"; Sendungsmitschnitte werden nicht angenommen.
- Die Web-App dekodiert die Datei im Browser und streamt PCM16 mit 1,0-facher Echtzeit über den Live-Vertrag; die Karten erscheinen wie live. Die Datei verlässt das Gerät nur als Audiostrom und liegt nie auf dem Server.

## 13. Offen

- iOS-Tonabgriff über ScreenCaptureKit ab iOS 27: Nebel; iPhone bleibt beim Mikrofon mit Kurzdialog.
- Desktop nativ mit Systemton: Nebel, graduiert erst auf Nachfrage von Nutzern.
- Token-Modell für Web-App und Store-App: Konten (#13), Sicherheit (#22).
- Gestaltung von Wake-Lock-Hinweis, "Tonabgriff wählen", "Aufnahme unterbrochen", Volumenhinweis: Live-Ansicht (#16).
- Ob die Store-Ausnahmen für Audio tragen: Anwalt (#42).
