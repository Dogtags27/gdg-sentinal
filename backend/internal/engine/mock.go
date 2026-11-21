package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"
)

// Mock is a deterministic stand-in for the Python engine (MOCK_ENGINE=true), so the console works end to
// end through the gateway before the engine exists. It mirrors frontend/src/api/mockEngine.js and the
// thresholds in engine/app/policy/gate.py; the burst rule mirrors engine/app/policy/burst.py.
type Mock struct {
	Delay  func(r *rand.Rand) time.Duration // simulated engine time; nil means no wait
	Now    func() time.Time
	ids    atomic.Int64
	mu     sync.Mutex
	events []burstEvent
}

func NewMock() *Mock {
	return &Mock{
		Delay: func(r *rand.Rand) time.Duration { return time.Duration(400+r.IntN(500)) * time.Millisecond },
		Now:   time.Now,
	}
}

func (m *Mock) Mode() string                     { return "mock" }
func (m *Mock) Health(ctx context.Context) error { return nil }

// Thresholds from EscalationGate in engine/app/policy/gate.py (DA-03).
const (
	highPriorityThreshold = 0.38
	confidenceFloor       = 0.42
	precedentSimilarity   = 0.28
	burstWindow           = 10 * time.Minute
	burstThreshold        = 3
)

var keywords = map[string][]string{
	"security":  {"breach", "hacked", "ransomware", "compromised", "phishing attack", "phishing link", "phished", "malware", "unauthorized access", "gehackt", "angriff", "verschlüsselt", "lösegeld", "datenleck", "schadsoftware", "kompromittiert"},
	"outage":    {"outage", "is down", "are down", "server down", "vpn down", "not reachable", "unreachable", "cannot connect", "can't connect", "ausgefallen", "ausfall", "nicht erreichbar", "störung", "keine verbindung"},
	"money":     {"refund", "compensation", "chargeback", "money back", "discount", "pricing", "contract terms", "erstattung", "rückerstattung", "entschädigung", "gutschrift", "rabatt"},
	"legal":     {"lawyer", "lawsuit", "legal action", "gdpr", "dsgvo", "delete all my data", "delete my data", "attorney", "anwalt", "klage", "rechtliche schritte", "daten löschen"},
	"injection": {"ignore previous", "ignore all previous", "ignore your instructions", "system prompt", "you are now", "disregard all", "ignoriere alle", "ignoriere die vorherigen"},
	"billing":   {"invoice", "billing", "payment", "charged", "vat", "rechnung", "zahlung", "abbuchung"},
	"password":  {"password", "locked out", "login attempts", "log in", "sign in", "2fa", "passwort", "zurücksetzen", "gesperrt", "anmelden"},
	"feature":   {"feature request", "feature", "enhancement", "would be great", "vorschlag"},
	"product":   {"app", "crash", "crashes", "update", "version", "install", "installation", "sync", "synchronisiert", "synchronisierung", "absturz", "desktop"},
}

var categoryOrder = []string{"security", "outage", "money", "legal", "billing", "password", "feature", "product"}

// Outage signatures from engine/app/policy/burst.py.
var burstSignatures = []string{"vpn", "gateway", "outage", "timeout", "server down", "datenbank", "ausfall", "504", "502", "telemedicine", "hospital", "login failure"}

type profile struct {
	typ, queue, priority string
	pHigh, sim, conf     float64
}

var profiles = map[string]profile{
	"security": {"Incident", "IT Support", "high", 0.91, 0.84, 0.9},
	"outage":   {"Incident", "Service Outages and Maintenance", "high", 0.88, 0.88, 0.89},
	"money":    {"Request", "Billing and Payments", "medium", 0.27, 0.79, 0.8},
	"legal":    {"Request", "Customer Service", "medium", 0.31, 0.74, 0.76},
	"billing":  {"Request", "Billing and Payments", "low", 0.12, 0.86, 0.88},
	"password": {"Request", "IT Support", "medium", 0.21, 0.91, 0.92},
	"feature":  {"Change", "Product Support", "low", 0.06, 0.72, 0.81},
	"product":  {"Problem", "Technical Support", "medium", 0.3, 0.8, 0.84},
	"general":  {"Request", "General Inquiry", "low", 0.1, 0.24, 0.38},
}

// Second-choice queue for the routing path (level 1 keeps the top 2 unless the first is confident).
var runnerUp = map[string]string{
	"Service Outages and Maintenance": "IT Support",
	"IT Support":                      "Technical Support",
	"Billing and Payments":            "Customer Service",
	"Customer Service":                "General Inquiry",
	"Product Support":                 "Technical Support",
	"Technical Support":               "Product Support",
	"General Inquiry":                 "Customer Service",
}

var bank = map[string][][3]string{
	"security": {{"TKT-00417", "Ransomware note on file server", "en"}, {"TKT-02981", "Account compromised after phishing email", "en"}, {"TKT-05520", "Unbefugte Anmeldungen am Admin-Konto", "de"}},
	"outage":   {{"TKT-02210", "VPN gateway down for all remote staff", "en"}, {"TKT-04471", "VPN-Verbindung bricht ständig ab", "de"}, {"TKT-06013", "Klinik-Netzwerk nicht erreichbar", "de"}},
	"money":    {{"TKT-01276", "Requesting refund for annual plan", "en"}, {"TKT-05034", "Compensation for downtime last week", "en"}, {"TKT-03890", "Rückerstattung nach Kündigung", "de"}},
	"legal":    {{"TKT-02647", "GDPR data deletion request", "en"}, {"TKT-06120", "Auskunftsersuchen nach DSGVO", "de"}, {"TKT-03455", "Legal notice regarding contract", "en"}},
	"billing":  {{"TKT-00933", "Where can I download my invoice?", "en"}, {"TKT-04108", "Doppelte Abbuchung auf Rechnung", "de"}, {"TKT-06655", "Invoice shows wrong VAT", "en"}},
	"password": {{"TKT-01842", "Password reset link not arriving", "en"}, {"TKT-03317", "Locked out after too many attempts", "en"}, {"TKT-07702", "Passwort zurücksetzen funktioniert nicht", "de"}},
	"feature":  {{"TKT-01590", "Feature request: dark mode", "en"}, {"TKT-04822", "Vorschlag: Export als CSV", "de"}, {"TKT-07311", "Enhancement: bulk edit", "en"}},
	"product":  {{"TKT-00718", "App crashes after update", "en"}, {"TKT-03602", "Sync not working on desktop client", "en"}, {"TKT-05947", "Installation schlägt unter Windows fehl", "de"}},
	"general":  {{"TKT-02034", "Question about support hours", "en"}, {"TKT-06408", "Allgemeine Anfrage zum Produkt", "de"}, {"TKT-04563", "Who is my account manager?", "en"}},
}

var (
	hello  = map[string]string{"en": "Hello,\n\n", "de": "Guten Tag,\n\n"}
	sign   = map[string]string{"en": "\n\nBest regards,\nSupport Team", "de": "\n\nMit freundlichen Grüßen\nIhr Support-Team"}
	drafts = map[string]map[string]string{
		"en": {
			"security": "Thank you for reporting this so quickly. We are treating it as a security incident and our on-call security team has been notified [c0]. As an immediate step, please disconnect affected devices from the network and do not pay any ransom or reply to the sender [c1]. A team member will contact you directly to coordinate next steps.",
			"outage":   "Thank you for letting us know. We have escalated the outage to our on-call engineers [c0]. While we investigate, please restart the VPN client and tell us whether other users at your site are affected [c1]. We will update this ticket as soon as service is restored.",
			"money":    "Thank you for contacting us, and we understand your frustration. Refund and compensation decisions are made by our billing team, so we have forwarded your request to them for review [c0]. We are not able to confirm a refund in this reply. You will hear back once the review is complete [c1].",
			"legal":    "Thank you for your request. We have forwarded it to our data protection team, who handle requests of this kind [c0]. They will confirm the next steps with you directly [c1].",
			"billing":  "Thank you for your message about your invoice. You can download all invoices under Account → Billing [c0]. If an amount or detail looks incorrect, reply with the invoice number and our billing team will review and reissue it [c1].",
			"password": "Thanks for reaching out. To reset your password, open the sign-in page and choose \"Forgot password\". A reset link will arrive by email and stays valid for 24 hours [c0]. If it does not arrive, check your spam folder or reply here and we will start a manual reset after verifying your account [c1].",
			"feature":  "Thank you for the suggestion. We have logged it with our product team for review [c0]. We can't commit to a timeline, but we will update this ticket if it is planned [c1].",
			"product":  "Thanks for the details. Please update to the latest version and restart the application, which resolved similar reports [c0]. If the problem continues, send us the app version and a screenshot of the error so we can investigate [c1].",
			"general":  "Thank you for reaching out. We have received your request and a member of our team will look into it [c0]. If you can share more details, such as screenshots or the steps you took, that will help us respond faster [c1].",
		},
		"de": {
			"security": "vielen Dank für Ihre schnelle Meldung. Wir behandeln den Vorfall als Sicherheitsvorfall und haben unser Bereitschaftsteam informiert [c0]. Bitte trennen Sie betroffene Geräte sofort vom Netzwerk und zahlen Sie kein Lösegeld [c1]. Ein Teammitglied meldet sich direkt bei Ihnen.",
			"outage":   "vielen Dank für Ihre Meldung. Wir haben die Störung an unser Bereitschaftsteam eskaliert [c0]. Bitte starten Sie den VPN-Client neu und teilen Sie uns mit, ob weitere Nutzer an Ihrem Standort betroffen sind [c1]. Wir informieren Sie, sobald der Dienst wiederhergestellt ist.",
			"money":    "vielen Dank für Ihre Nachricht. Über Erstattungen entscheidet unser Abrechnungsteam, an das wir Ihre Anfrage weitergeleitet haben [c0]. Eine Erstattung können wir in dieser Antwort nicht zusagen. Sie erhalten eine Rückmeldung, sobald die Prüfung abgeschlossen ist [c1].",
			"legal":    "vielen Dank für Ihre Anfrage. Wir haben sie an unser Datenschutzteam weitergeleitet [c0]. Das Team stimmt die nächsten Schritte direkt mit Ihnen ab [c1].",
			"billing":  "vielen Dank für Ihre Nachricht zu Ihrer Rechnung. Alle Rechnungen finden Sie im Kundenportal unter Konto → Abrechnung [c0]. Wenn ein Betrag nicht stimmt, senden Sie uns bitte die Rechnungsnummer, damit unser Abrechnungsteam ihn prüfen kann [c1].",
			"password": "vielen Dank für Ihre Anfrage. Um Ihr Passwort zurückzusetzen, öffnen Sie die Anmeldeseite und wählen Sie „Passwort vergessen“. Der Link kommt per E-Mail und ist 24 Stunden gültig [c0]. Falls keine E-Mail ankommt, prüfen Sie bitte Ihren Spam-Ordner oder antworten Sie hier [c1].",
			"feature":  "vielen Dank für Ihren Vorschlag. Wir haben ihn an unser Produktteam weitergegeben [c0]. Einen Zeitplan können wir nicht zusagen, wir aktualisieren aber dieses Ticket, sobald es Neuigkeiten gibt [c1].",
			"product":  "vielen Dank für die Details. Bitte aktualisieren Sie auf die neueste Version und starten Sie die Anwendung neu; das hat bei ähnlichen Meldungen geholfen [c0]. Falls das Problem weiterhin besteht, senden Sie uns bitte die Versionsnummer und einen Screenshot [c1].",
			"general":  "vielen Dank für Ihre Nachricht. Wir haben Ihre Anfrage erhalten und ein Teammitglied kümmert sich darum [c0]. Weitere Details wie Screenshots helfen uns, schneller zu antworten [c1].",
		},
	}
)

var langWords = []struct {
	code  string
	words map[string]bool
}{
	{"en", set("the", "and", "is", "not", "we", "our", "please", "with", "can", "my", "have", "for", "you", "since", "all")},
	{"de", set("der", "die", "das", "und", "nicht", "ich", "ist", "wir", "bitte", "unser", "unsere", "seit", "mit", "kann", "keine", "für", "auf", "eine", "haben", "sind", "hallo")},
	{"fr", set("bonjour", "merci", "je", "nous", "avec", "votre", "mon", "depuis", "pas", "de", "le", "la")},
	{"es", set("hola", "gracias", "problema", "nuestro", "por", "favor", "cuenta", "mi", "el", "los")},
	{"it", set("ciao", "buongiorno", "grazie", "il", "non", "della", "sono", "abbiamo", "posso", "accedere", "che", "mio")},
}

// Result shape the console reads (see frontend/README.md). PROVISIONAL until contracts/ v1.
type (
	label struct {
		Label      string  `json:"label"`
		Confidence float64 `json:"confidence"`
	}
	queueLabel struct {
		label
		Votes int `json:"votes"`
		K     int `json:"k"`
	}
	priorityLabel struct {
		label
		PHigh float64 `json:"p_high"`
	}
	precedent struct {
		TicketID   string  `json:"ticket_id"`
		Subject    string  `json:"subject"`
		Language   string  `json:"language"`
		Similarity float64 `json:"similarity"`
		Type       string  `json:"type"`
		Queue      string  `json:"queue"`
		Priority   string  `json:"priority"`
	}
	reason struct {
		Code     string `json:"code"`
		Severity string `json:"severity"`
		Detail   string `json:"detail"`
	}
	routedQueue struct {
		Queue string  `json:"queue"`
		Score float64 `json:"score"`
	}
	mockResult struct {
		TicketID    string    `json:"ticket_id"`
		Subject     string    `json:"subject"`
		Body        string    `json:"body"`
		CreatedAt   time.Time `json:"created_at"`
		ProcessedAt time.Time `json:"processed_at"`
		Language    struct {
			Code       string  `json:"code"`
			Confidence float64 `json:"confidence"`
		} `json:"language"`
		Classification struct {
			Type     label         `json:"type"`
			Queue    queueLabel    `json:"queue"`
			Priority priorityLabel `json:"priority"`
		} `json:"classification"`
		Routing struct {
			Queues         []routedQueue `json:"queues"`
			FallbackGlobal bool          `json:"fallback_global"`
		} `json:"routing"`
		Precedents []precedent `json:"precedents"`
		Gate       struct {
			Decision string   `json:"decision"`
			Reasons  []reason `json:"reasons"`
		} `json:"gate"`
		Draft struct {
			Language   string   `json:"language"`
			Text       string   `json:"text"`
			Citations  []string `json:"citations"`
			Mode       string   `json:"mode"`
			Validation struct {
				Passed      bool     `json:"passed"`
				CitationsOK bool     `json:"citations_ok"`
				NumbersOK   bool     `json:"numbers_ok"`
				Retries     int      `json:"retries"`
				Issues      []string `json:"issues"`
			} `json:"validation"`
		} `json:"draft"`
		LatencyMS map[string]float64 `json:"latency_ms"`
		Burst     *struct {
			ClusterID string `json:"cluster_id"`
		} `json:"burst"`
	}
)

var reasonSeverity = map[string]string{
	"HIGH_PRIORITY_INCIDENT": "P1", "SECURITY_INCIDENT": "P1", "ACTIVE_OUTAGE": "P1",
	"LEGAL_OR_COMPLIANCE": "P2", "PROMPT_INJECTION": "P2", "NO_PRECEDENT": "P2", "LOW_CONFIDENCE": "P2",
	"UNSUPPORTED_REQUEST": "P2", "UNGROUNDED_DRAFT": "P2", "UNSUPPORTED_LANGUAGE": "P2", "ENGINE_DEGRADED": "P2",
}

func (m *Mock) Triage(ctx context.Context, req Request) (Result, error) {
	h := fnv.New64a()
	h.Write([]byte(req.Subject + "\n" + req.Body))
	r := rand.New(rand.NewPCG(h.Sum64(), 0x5e47))
	if m.Delay != nil {
		select {
		case <-time.After(m.Delay(r)):
		case <-ctx.Done():
			return nil, &Error{Status: 499, Code: "CANCELLED", Message: "The request was cancelled.", Err: ctx.Err()}
		}
	}
	res := m.analyze(req, r)
	raw, err := json.Marshal(res)
	if err != nil {
		return nil, err
	}
	var out Result
	return out, json.Unmarshal(raw, &out)
}

func (m *Mock) analyze(req Request, r *rand.Rand) mockResult {
	now := m.Now()
	text := req.Subject + "\n" + req.Body
	lower := strings.ToLower(text)

	var res mockResult
	res.TicketID = req.TicketID
	if res.TicketID == "" {
		res.TicketID = fmt.Sprintf("LIVE-%04d", m.ids.Add(1))
	}
	res.Subject, res.Body = req.Subject, req.Body
	res.CreatedAt, res.ProcessedAt = now.UTC(), now.UTC()

	res.Language.Code, res.Language.Confidence = detectLanguage(lower, text)
	draftLang := "en"
	if res.Language.Code == "de" {
		draftLang = "de"
	}

	hits := map[string]string{}
	for group, words := range keywords {
		hits[group] = firstHit(lower, words)
	}
	category := "general"
	for _, c := range categoryOrder {
		if hits[c] != "" {
			category = c
			break
		}
	}
	p := profiles[category]

	pHigh := round2(clamp(p.pHigh+between(r, -0.04, 0.04), 0.02, 0.98))
	priority := p.priority
	if pHigh >= highPriorityThreshold {
		priority = "high"
	}
	strong := p.conf >= 0.75
	votes := 2 + r.IntN(2)
	if strong {
		votes = 4 + r.IntN(2)
	}
	c := &res.Classification
	c.Type = label{p.typ, round2(math.Min(0.99, p.conf+between(r, 0, 0.06)))}
	c.Queue = queueLabel{label{p.queue, round2(math.Min(0.99, p.conf+between(r, -0.05, 0.02)))}, votes, 5}
	c.Priority = priorityLabel{label{priority, round2(math.Min(0.99, p.conf+between(r, -0.06, 0.03)))}, pHigh}

	top := math.Min(0.97, p.sim+between(r, -0.03, 0.03))
	for i, b := range bank[category] {
		res.Precedents = append(res.Precedents, precedent{b[0], b[1], b[2], round2(top - float64(i)*between(r, 0.03, 0.07)), p.typ, p.queue, p.priority})
	}

	// Level 1 route: keep only the top queue when it is confident, else the top two.
	res.Routing.Queues = []routedQueue{{p.queue, round2(0.6*c.Queue.Confidence + 0.4*top)}}
	if res.Routing.Queues[0].Score < 0.8 {
		if second, ok := runnerUp[p.queue]; ok {
			res.Routing.Queues = append(res.Routing.Queues, routedQueue{second, round2(res.Routing.Queues[0].Score * between(r, 0.55, 0.8))})
		}
	}
	res.Routing.FallbackGlobal = res.Precedents[0].Similarity < precedentSimilarity

	reasons := []reason{}
	add := func(code, detail string) { reasons = append(reasons, reason{code, reasonSeverity[code], detail}) }
	if c.Type.Label == "Incident" && pHigh >= highPriorityThreshold {
		add("HIGH_PRIORITY_INCIDENT", fmt.Sprintf("P(high) = %.2f ≥ threshold %.2f", pHigh, highPriorityThreshold))
	}
	if hits["security"] != "" {
		add("SECURITY_INCIDENT", fmt.Sprintf("Matched “%s”", hits["security"]))
	}
	if category == "outage" {
		if cluster := m.recordBurst(lower, res.TicketID, now); cluster != "" {
			add("ACTIVE_OUTAGE", "Joined burst cluster "+cluster)
			res.Burst = &struct {
				ClusterID string `json:"cluster_id"`
			}{cluster}
		}
	}
	if hits["legal"] != "" {
		add("LEGAL_OR_COMPLIANCE", fmt.Sprintf("Matched “%s”", hits["legal"]))
	}
	if hits["injection"] != "" {
		add("PROMPT_INJECTION", fmt.Sprintf("Matched “%s”", hits["injection"]))
	}
	if res.Precedents[0].Similarity < precedentSimilarity {
		add("NO_PRECEDENT", fmt.Sprintf("Top-1 similarity %.2f < %.2f", res.Precedents[0].Similarity, precedentSimilarity))
	}
	if minConf := math.Min(c.Type.Confidence, math.Min(c.Queue.Confidence, c.Priority.Confidence)); minConf < confidenceFloor {
		add("LOW_CONFIDENCE", fmt.Sprintf("Calibrated confidence %.2f < floor %.2f", minConf, confidenceFloor))
	}
	if hits["money"] != "" {
		add("UNSUPPORTED_REQUEST", fmt.Sprintf("Matched “%s” — no commitments in draft", hits["money"]))
	}
	if res.Language.Code != "en" && res.Language.Code != "de" {
		add("UNSUPPORTED_LANGUAGE", fmt.Sprintf("Detected %s (%d%%)", strings.ToUpper(res.Language.Code), int(math.Round(res.Language.Confidence*100))))
	}
	res.Gate.Reasons = reasons
	res.Gate.Decision = "AUTO_DRAFT"
	for _, x := range reasons {
		if x.Severity == "P1" {
			res.Gate.Decision = "ESCALATE_ONCALL"
			break
		}
		res.Gate.Decision = "HUMAN_REVIEW"
	}

	c0, c1 := res.Precedents[0].TicketID, res.Precedents[1].TicketID
	core := strings.NewReplacer("[c0]", "["+c0+"]", "[c1]", "["+c1+"]").Replace(drafts[draftLang][category])
	d := &res.Draft
	d.Language, d.Text, d.Citations, d.Mode = draftLang, hello[draftLang]+core+sign[draftLang], []string{c0, c1}, "generated"
	d.Validation.Passed, d.Validation.CitationsOK, d.Validation.NumbersOK, d.Validation.Issues = true, true, true, []string{}

	res.LatencyMS = map[string]float64{
		"language": between(r, 2, 6),
		"classify": between(r, 12, 28),
		"retrieve": between(r, 38, 95),
		"gate":     between(r, 1, 3),
		"draft":    between(r, 650, 1750),
		"validate": between(r, 14, 42),
	}
	total := 0.0
	for _, v := range res.LatencyMS {
		total += v
	}
	res.LatencyMS["total"] = total
	return res
}

type burstEvent struct {
	at        time.Time
	signature string
	ticketID  string
}

// recordBurst returns a cluster ID once burstThreshold outage tickets with the same signature arrive
// within burstWindow, like OutageBurstDetector in engine/app/policy/burst.py.
func (m *Mock) recordBurst(lower, ticketID string, now time.Time) string {
	sig := ""
	for _, s := range burstSignatures {
		if strings.Contains(lower, s) {
			sig = s
			break
		}
	}
	if sig == "" {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.events[:0]
	for _, e := range m.events {
		if now.Sub(e.at) <= burstWindow {
			kept = append(kept, e)
		}
	}
	m.events = append(kept, burstEvent{now, sig, ticketID})
	n := 0
	for _, e := range m.events {
		if e.signature == sig {
			n++
		}
	}
	if n < burstThreshold {
		return ""
	}
	return "BURST-" + strings.ToUpper(strings.ReplaceAll(sig, " ", "_")) + "-SERVICE"
}

func detectLanguage(lower, text string) (string, float64) {
	scores := make([]int, len(langWords))
	for _, w := range strings.FieldsFunc(lower, func(c rune) bool { return !unicode.IsLetter(c) }) {
		for i, l := range langWords {
			if l.words[w] {
				scores[i]++
			}
		}
	}
	if strings.ContainsAny(lower, "äöüß") {
		scores[1] += 2
	}
	idx := make([]int, len(scores))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return scores[idx[a]] > scores[idx[b]] })
	top := scores[idx[0]]
	if top == 0 {
		return "en", 0.55
	}
	margin := top - scores[idx[1]]
	return langWords[idx[0]].code, round2(math.Min(0.99, 0.72+float64(margin)*0.05))
}

// firstHit returns the first keyword found with letter boundaries on both sides (Unicode-aware).
func firstHit(lower string, words []string) string {
	for _, w := range words {
		for from := 0; ; {
			i := strings.Index(lower[from:], w)
			if i < 0 {
				break
			}
			start, end := from+i, from+i+len(w)
			before, _ := utf8.DecodeLastRuneInString(lower[:start])
			after, _ := utf8.DecodeRuneInString(lower[end:])
			if (start == 0 || !unicode.IsLetter(before)) && (end == len(lower) || !unicode.IsLetter(after)) {
				return w
			}
			from = start + 1
		}
	}
	return ""
}

func set(words ...string) map[string]bool {
	m := make(map[string]bool, len(words))
	for _, w := range words {
		m[w] = true
	}
	return m
}

func between(r *rand.Rand, lo, hi float64) float64 { return lo + r.Float64()*(hi-lo) }
func round2(x float64) float64                     { return math.Round(x*100) / 100 }
func clamp(x, lo, hi float64) float64              { return math.Max(lo, math.Min(hi, x)) }
