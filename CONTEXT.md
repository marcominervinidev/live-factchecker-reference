# live-factchecker

A product that listens to a spoken exchange, pulls out the factual claims in it, checks each one against sources, and shows the result on a card while the exchange is still running. Canonical terms are English; the German word in brackets is the UI label, or, for terms the User never sees, the word used in German prose.

## Language

**Conversation** (UI: Gespräch):
A recorded spoken exchange that the product checks, such as a TV debate or a private conversation.
_Avoid_: Recording, Aufnahme, Meeting

**Session**:
The technical carrier of one Conversation on the backend, from the moment a client connects until it disconnects or the Conversation ends; it has an id and a lifetime, the Conversation has the meaning. Code may say Session; people say Conversation.
_Avoid_: using Session for the thing people talk about

**Input** (Eingang):
The way the audio or the Transcript of a Conversation reaches the product, such as the microphone of a client, a file, a broadcast stream or speech recognition running on the device. An Input need not have a known end.
_Avoid_: Source, Quelle (a Source is cited by a Check), Feed, Recording, Aufnahme

**Edge** (Edge):
The single public entry of the stack (Caddy) that terminates TLS and forwards only the routes it names to a service; a path it does not route it answers itself.
_Avoid_: Eingang (that is the Input), Gateway, Proxy as a name

**Transcript** (UI: Transkript):
The written text of a Conversation, produced while the Conversation runs.
_Avoid_: Protokoll, Mitschrift

**Segment**:
The technical piece of Transcript text that transcription emits, cut at pauses, punctuation and every change of Speaker, so that a Segment always belongs to exactly one Speaker; it has no meaning of its own and is only the material that Turns and Claims are built from.
_Avoid_: Satz, Sentence, Äußerung, Utterance

**Turn** (UI: Redebeitrag):
The connected speech of one Speaker, from the moment they start until the Speaker changes, a longer pause occurs or a maximum length is reached. A brief interjection by another Speaker that overlaps the ongoing speech does not end the Turn; the interjection is a Turn of its own.
_Avoid_: Absatz, Paragraph, Statement, Beitrag

**Tick** (Takt):
The moment both extractors run: after every five seconds of speech of the current Speaker, and once more when the Turn ends.
_Avoid_: Interval, Window, Fenster, Zyklus

**Speaker** (UI: Sprecher):
A participant in a Conversation to whom passages of the Transcript are attributed; a Speaker may carry a name given in the Setting or stay an anonymous label. The name reaches a Speaker only through an Attribution, never from the voice.
_Avoid_: Teilnehmer, Participant, User (the User is the person operating the product, not necessarily a Speaker)

**Attribution** (Zuordnung):
The link between a diarisation label and a Speaker, with its source (Setting, address in the Transcript, programme data, the User) and its certainty (certain, probable, none); it holds for one Session only. In text mode of the measurement the names come from the reference transcript, for the measurement only.
_Avoid_: Identifikation, Erkennung, Matching, Voice ID

**Model call** (Modellaufruf):
One request to a language model for one task of the product, such as the Speaker Mapper, the Topic Extractor, the Claim Extractor, the Resolver, the Verifier or the model call of a Prefetch. Each model call is recorded once with its tokens, duration and cost, and its tokens and cost count towards its Session.

**Speaker Mapper** (Sprecher-Zuordner):
The model call outside the Tick that keeps the Attributions of a Session: it runs on a new label, an address or introduction in the Transcript, a change of the Setting or an intervention by the User.
_Avoid_: Speaker recognition, Voice ID, Identifier

**Setting** (UI: Rahmen):
What the User enters before a Conversation starts: the mode (a broadcast or a conversation in the room), who takes part, named as Speakers with their role and whether they are public figures, and the Topic the Conversation begins with. Only the mode is mandatory. The Setting stays fixed for the whole Conversation and starts the first Prefetch.
_Avoid_: Kontext, Context, Briefing, Vorab-Info, Session description

**Topic** (UI: Thema):
What a Conversation is about at a given moment. It starts from the Setting and can change at any time while the Conversation runs; every new Topic starts a Prefetch, and its tag steers which Evidence a Check reads first.
_Avoid_: Kontext, Context, Subject

**Prefetch** (Vorrecherche):
Loading Evidence about a Topic into the Evidence Store before any Claim about it is made; started by the Setting and by every new Topic, and only from Sources whose licence allows storing.
_Avoid_: Vorab-Recherche, Preload, Index-Aufbau, Vorab-Laden

**Evidence Store** (Belegspeicher):
Where the Evidence a Prefetch loaded for one Conversation lives, tagged by Topic; it lives as long as the Session and never holds Transcript text.
_Avoid_: Cache, Evidenz-Speicher, Index

**Shared Index** (gemeinsamer Index):
The permanently kept, regularly refreshed collection of storable Sources that every Conversation may draw on, such as published fact checks and official statistics.
_Avoid_: Cache, Datenbank, Wissensbasis

**Topic Extractor** (Themen-Extraktor):
The model call that runs on every Tick and keeps the list of Topics of a Conversation: it decides whether the newest speech starts a Topic, continues one or returns to one.
_Avoid_: Topic classifier, Themenerkennung

**Claim** (UI: Behauptung):
A checkable factual assertion built from one or more Segments of the Transcript and attributed to a Speaker by name or label. It is phrased as a self-contained sentence, which is always a paraphrase, and keeps the verbatim excerpt it was built from. A reply that affirms or denies another Speaker's Claim is itself a Claim about the same fact.
_Avoid_: Statement, Aussage, Fakt, Fact, Äußerung

**Claim Extractor** (Behauptungs-Extraktor):
The first of two stages of detection: the model call that runs on every Tick, reads the current Speaker's Turn so far with its context, and returns zero or more Claims or Candidates.
_Avoid_: Detector, Classifier, Klassifikator, Detection

**Candidate** (Kandidat):
A passage the Claim Extractor takes for a possible Claim but cannot resolve on its own, with the reason why (a reference outside its context, an unclear factual core, an unclear Speaker); it goes to the Resolver and never to a Card.
_Avoid_: Draft claim, vorläufige Behauptung, unsichere Behauptung

**Resolver** (Klärer):
The second stage of detection: a stronger model call outside the Tick that receives a Candidate with more context and turns it into a Claim or decides that it is none; what it cannot resolve is recorded and never shown.
_Avoid_: Stufe 2 as a name, Eskalation, Fallback

**Verifier** (Prüfstufe):
The model call after the Claim Extractor and the Resolver that decides for each Claim, before its Card appears, whether it is checkable and of public relevance; a Claim it rejects is recorded with its reason and never shown, and on error or timeout the Card appears anyway (fail-open).
_Avoid_: Filter, Klassifikator, Check (the Check is the later verdict on a shown Claim)

**Check** (UI: Prüfung):
The process that turns one Claim into a Verdict by gathering Evidence; it must finish within 30 seconds of the Claim being extracted.
_Avoid_: Fact-check (the product does fact-checking; a single run is a Check), Verification, Recherche

**Source** (UI: Quelle):
One external origin of information cited by a Check, such as a publication, database entry or official statistic.
_Avoid_: Reference, Link, Beleg

**Evidence** (UI: Belege):
The set of Sources a Check gathered for a Claim, each with what it says about the Claim.
_Avoid_: Proof, Nachweis, Research results

**Verdict** (UI: Urteil):
The outcome of a Check on a Claim, one of five values taken over from live-factcheck: Correct (stimmt), Mostly correct (größtenteils richtig), Exaggerated (übertrieben), Incorrect (falsch), Unverifiable (nicht prüfbar). A Verdict carries a confidence. A pure value judgement without a factual core, and a prediction, never reach a Check: neither becomes a Claim, so "not a factual claim" is not a Verdict.
_Avoid_: Result, Ergebnis, Rating, Score, Bewertung

**Assessment** (UI: Einschätzung):
A model's answer to a Claim given without Evidence, using the same five values as a Verdict; it is always shown as an Assessment, never as a Verdict, and the User can request a Check to replace it. Low-priority Claims receive an Assessment while the Check queue serves the more checkworthy ones.
_Avoid_: Urteil ohne Quellen, Quick Check, Schätzung, Vorab-Urteil

**Card** (UI: Karte):
What the User sees for one Claim: the Claim text appears as soon as the Claim is extracted, and the Verdict with its Evidence, or an Assessment marked as such, is written onto the same Card when it is ready.
_Avoid_: Tile, Result card, Ergebnis, Entry

**Private Matter** (Privates):
A statement about a person who is not publicly known, from the circle of the Speakers, such as someone present, family, friends, neighbours or colleagues; it never becomes a Claim or a Candidate. A statement about a public figure is not a Private Matter, even when it concerns their private life or publicly known facts about their family.
_Avoid_: PII, Privatsphäre-Filter, sensibel, sensitive

**Consent Record** (Einwilligungsnachweis):
The record that the User confirmed the consent dialog before a Conversation: which account, Session, mode and dialog version, when, how many Speakers the Setting named, and whether the spoken announcement played. It never holds names, audio or content.
_Avoid_: Consent Log, Einwilligungsprotokoll, Audit-Trail

**History** (UI: Verlauf):
The Cards of a Conversation that the User chooses to keep with their account, never the Transcript; names and verbatim text stay in it only for public Speakers.
_Avoid_: Archiv, Aufzeichnung, Recording, Sitzungsverlauf

**Client**:
The program on the User's device that opens an Input, shows the Setting, the consent dialog and the Cards, and speaks to the backend: the Web-App in a browser, a Store-App on a phone, or the operator's ingestion process for a broadcast.
_Avoid_: App (ambiguous between Web-App and Store-App), Frontend, Endgerät

**Device Mode** (UI: Gerätemodus):
The way of running a Conversation in which transcription and speaker separation happen on the User's device and only Segments reach the backend, so that the sound never leaves the device; detection and Checks still run in the cloud. Transcription without speaker separation is not a Device Mode.
_Avoid_: Offline-Modus, lokaler Modus, On-Device als Produktname, Privacy Mode

**Channel Capture** (UI: Tonabgriff; in prose also Kanalabgriff):
Taking the sound of a broadcast as the Input directly from the device or app that plays it (tab audio, playback capture, line-in) instead of through the microphone, so that people in the room are not in the signal. It replaces the microphone; a Conversation has exactly one Input.
_Avoid_: Loopback, Systemton as the product term, Screen Recording
