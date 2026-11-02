import React, { useState, useEffect, useCallback } from 'react';

const API_URL = 'https://script.google.com/macros/s/AKfycbwC8lA-Im1obJfn_6MKCbXv_rswuJdI7JQp0t28114yt-XSU3eXoq2ru9TDvyFm6eUo/exec';
const REFRESH_MS = 10000;
const SHIFT_SWITCH_HOUR = 11; // vanaf dit uur wordt PM getoond
const COLUMNS = 3;            // 3 x 3 = 9 kaarten per scherm

// Telling van het totaal aantal ritten per dienst.
// column = kolomindex in de sheet (A = 0, B = 1, C = 2, ... L = 11)
const COUNT_RULES = {
  AM: { column: 2, marker: 'NIEAM' },  // kolom C
  PM: { column: 11, marker: 'NIEPM' }, // kolom L
};

const C = {
  bg: '#060a13',
  surface: '#0e1626',
  border: '#1f2b42',
  text: '#f1f5f9',
  muted: '#7b8aa3',
  emerald: '#10b981',
  slate: '#94a3b8',
  rose: '#f43f5e',
  sky: '#38bdf8',
  plateYellow: '#facc15',
  plateBlue: '#1d4ed8',
};

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = '"SF Mono", Consolas, "Liberation Mono", Menlo, monospace';

const SHIFT_LABEL = { AM: 'Ochtend · AM', PM: 'Middag · PM' };

/* ---------- Data helpers ---------- */

const isPositive = (val) => {
  if (val === true || val === 1) return true;
  if (val === false || val === 0 || val == null || val === '') return false;
  return ['TRUE', 'WAAR', 'JA', 'YES', '1'].includes(String(val).trim().toUpperCase());
};

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

const getValue = (row, fieldType, shift) => {
  const t = normalize(fieldType);
  const s = normalize(shift);
  const key = Object.keys(row).find((k) => {
    const c = normalize(k);
    return c.includes(t) && c.includes(s);
  });
  return key !== undefined ? row[key] : undefined;
};

const isValidName = (name) => {
  const n = String(name ?? '').trim();
  return n !== '' && n !== '-' && n.toUpperCase() !== 'OPEN ROUTE';
};

// Zet een waarde als 0.45 om naar "45%". Waarden boven 1 (bv. al 45) worden ongewijzigd als percentage getoond.
const formatPercent = (val) => {
  if (val === undefined || val === null || String(val).trim() === '' || String(val).trim() === '-') return '-';
  const n = parseFloat(String(val).replace(',', '.'));
  if (Number.isNaN(n)) return String(val);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${Math.round(pct)}%`;
};

// Bepaalt welke dienst nu getoond wordt: AM voor 11:00, daarna PM
const getActiveShift = (date) => (date.getHours() < SHIFT_SWITCH_HOUR ? 'AM' : 'PM');

// Telt per dienst het aantal rijen waarvan de vaste kolom de marker bevat (NIEAM in C, NIEPM in L)
const countTotals = (rows) => {
  const totals = { AM: 0, PM: 0 };
  rows.forEach((row) => {
    const values = Object.values(row);
    ['AM', 'PM'].forEach((shift) => {
      const { column, marker } = COUNT_RULES[shift];
      const cell = String(values[column] ?? '').toUpperCase();
      if (cell.includes(marker)) totals[shift] += 1;
    });
  });
  return totals;
};

// Zoekt de routes die klaar zijn voor vertrek (cool check gedaan, nog niet aanwezig)
const parseReadyRoutes = (rows) => {
  const ready = [];

  rows.forEach((row, rowIndex) => {
    ['AM', 'PM'].forEach((shift) => {
      const name = getValue(row, 'chauffeur', shift);
      if (!isValidName(name)) return;

      const cool = isPositive(getValue(row, 'cool', shift));
      const present = isPositive(getValue(row, 'aanwezig', shift));
      if (!cool || present) return;

      ready.push({
        id: `${shift}-${rowIndex}`,
        shift,
        name: String(name).trim(),
        route: String(getValue(row, 'ritnummer', shift) || '-'),
        plate: String(getValue(row, 'kenteken', shift) || 'ONBEKEND'),
        temp: getValue(row, 'temp', shift) || '-',
        battery: formatPercent(getValue(row, 'accu', shift)),
      });
    });
  });

  ready.sort((a, b) => a.route.localeCompare(b.route, 'nl', { numeric: true }));
  return ready;
};

const fmtTime = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ---------- Onderdelen ---------- */

const GlobalStyles = () => (
  <style>{`
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; background: ${C.bg}; overflow: hidden; }
    @keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.55); } 70% { box-shadow: 0 0 0 10px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fade-up { animation: fadeUp .45s ease both; }
    .live-dot { animation: ping 1.8s infinite; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-thumb { background: #1f2b42; border-radius: 3px; }
  `}</style>
);

// Het kenteken schaalt mee met de kaart (cqh / cqw = hoogte / breedte van de kaart)
function Plate({ value }) {
  return (
    <div style={{
      display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
      border: '2px solid #0f172a', flex: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
    }}>
      <div style={{
        background: C.plateBlue, color: '#fff', fontSize: 'min(4.6cqh, 1.9cqw)', fontWeight: 800,
        padding: '0 0.5em', display: 'flex', alignItems: 'center',
      }}>
        NL
      </div>
      <div style={{
        background: C.plateYellow, color: '#0f172a', fontFamily: MONO,
        fontWeight: 900, fontSize: 'min(12.5cqh, 4.7cqw)', letterSpacing: '0.12em',
        padding: '0.15em 0.5em', whiteSpace: 'nowrap', lineHeight: 1.2,
      }}>
        {value}
      </div>
    </div>
  );
}

function Pill({ color, label }) {
  return (
    <span style={{
      fontSize: 'min(6cqh, 2.4cqw)', fontWeight: 800, color, background: `${color}1a`,
      padding: '0.3em 0.6em', borderRadius: 8, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function ReadyCard({ r, index }) {
  return (
    <div className="fade-up" style={{
      animationDelay: `${index * 40}ms`,
      containerType: 'size',
      background: C.surface, border: `1px solid ${C.border}`, borderTop: `4px solid ${C.emerald}`,
      borderRadius: 18, boxShadow: '0 10px 28px rgba(0,0,0,.35)',
      minHeight: 0, minWidth: 0, overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <div style={{
        height: '100%', boxSizing: 'border-box',
        padding: '4.5cqh 5cqw',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '2.5cqh',
      }}>
        {/* Bovenste rij: dienst + status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2cqw', flex: 'none' }}>
          <span style={{
            fontSize: 'min(5cqh, 2.3cqw)', fontWeight: 700, letterSpacing: 1,
            color: C.muted, whiteSpace: 'nowrap',
          }}>
            {SHIFT_LABEL[r.shift]}
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: '0.6em',
            fontSize: 'min(4.6cqh, 2cqw)', fontWeight: 800, letterSpacing: 1,
            color: C.emerald, background: 'rgba(16,185,129,.12)',
            padding: '0.4em 0.9em', borderRadius: 999, whiteSpace: 'nowrap',
          }}>
            <span className="live-dot" style={{ width: '0.6em', height: '0.6em', borderRadius: '50%', background: C.emerald }} />
            KLAAR VOOR VERTREK
          </span>
        </div>

        {/* Ritnummer */}
        <div style={{
          fontSize: 'min(18cqh, 5.8cqw)', fontWeight: 900, lineHeight: 1.1, letterSpacing: -0.5,
          fontFamily: MONO, color: C.text, flex: 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {r.route}
        </div>

        {/* Chauffeur */}
        <div style={{
          fontSize: 'min(12cqh, 4.4cqw)', fontWeight: 700, color: C.text, lineHeight: 1.2, flex: 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {r.name}
        </div>

        {/* Onderste rij: kenteken + waarden */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: '2cqw', paddingTop: '2.5cqh', borderTop: `1px solid ${C.border}`, flex: 'none',
        }}>
          <Plate value={r.plate} />
          <div style={{ display: 'flex', gap: '1.2cqw' }}>
            <Pill color={C.sky} label={r.temp} />
            <Pill color={C.emerald} label={r.battery} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: C.text }}>
        {title}
      </h2>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div style={{
      gridColumn: '1 / -1', textAlign: 'center', padding: '80px 24px',
      background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 18,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.slate, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 15, color: C.muted }}>{text}</div>
    </div>
  );
}

/* ---------- Hoofdcomponent ---------- */

export default function App() {
  const [ready, setReady] = useState([]);
  const [totals, setTotals] = useState({ AM: 0, PM: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`Fout bij ophalen (${res.status}).`);

      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Onverwacht dataformaat ontvangen.');

      setReady(parseReadyRoutes(rows));
      setTotals(countTotals(rows));
      setError(null);
      setLoaded(true);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message || 'Kon geen verbinding maken met de Google API.');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const dataTimer = setInterval(fetchData, REFRESH_MS);
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [fetchData]);

  const activeShift = getActiveShift(now);

  // Tot 9 kaarten: 3 rijen die de beschikbare hoogte gelijk verdelen.
  // Meer dan 9: rijen krijgen een minimale hoogte en het raster scrolt.
  const rowCount = Math.max(3, Math.ceil(ready.length / COLUMNS));
  const rowMin = ready.length > 9 ? '34vh' : '0px';
  const rowTemplate = `repeat(${rowCount}, minmax(${rowMin}, 1fr))`;

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: `radial-gradient(1400px 700px at 10% -10%, #0d1d33 0%, ${C.bg} 60%)`,
      color: C.text, fontFamily: FONT, overflow: 'hidden', boxSizing: 'border-box',
    }}>
      <GlobalStyles />

      {/* Header */}
      <header style={{
        flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.8vh 40px', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.emerald}, #059669)`,
            display: 'grid', placeItems: 'center', boxShadow: '0 8px 24px rgba(16,185,129,.25)',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#04110c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.2, color: C.emerald, textTransform: 'uppercase' }}>
              Transport · Live
            </div>
            <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 800, letterSpacing: -0.5, color: '#fff' }}>
              Klaar voor vertrek
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {/* Totaal ritten voor de huidige dienst */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.8, color: C.muted, textTransform: 'uppercase' }}>
              Totaal ritten · {activeShift}
            </div>
            <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: C.sky, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {loaded ? totals[activeShift] : '—'}
            </div>
          </div>

          {/* Klok */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: 14, color: C.muted, marginTop: 6, textTransform: 'capitalize' }}>
              {now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>

          {/* Status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 999,
            border: `1px solid ${error ? C.rose : C.border}`,
            background: error ? 'rgba(244,63,94,.08)' : 'rgba(16,185,129,.06)',
            color: error ? C.rose : C.emerald, fontSize: 13, fontWeight: 800, letterSpacing: 1,
          }}>
            <span className="live-dot" style={{ width: 9, height: 9, borderRadius: '50%', background: error ? C.rose : C.emerald }} />
            {error ? 'VERBINDING VERSTOORD' : 'LIVE'}
          </div>
        </div>
      </header>

      {/* Inhoud */}
      {!loaded && !error ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: C.muted }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, fontWeight: 600, letterSpacing: 1 }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', border: `2px solid ${C.border}`,
              borderTopColor: C.emerald, animation: 'spin 1s linear infinite',
            }} />
            GEGEVENS LADEN…
          </div>
        </div>
      ) : error && !loaded ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <div style={{
            background: C.surface, border: `1px solid ${C.rose}`, borderRadius: 18,
            padding: 48, maxWidth: 560, textAlign: 'center',
          }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.rose, marginBottom: 12 }}>Verbindingsfout</div>
            <p style={{ color: C.slate, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
              {error}<br />Controleer de namen van de tabbladen en de toegang tot de Google Apps Script.
            </p>
            <button onClick={fetchData} style={{
              background: C.rose, color: '#fff', border: 'none', padding: '12px 26px',
              borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700,
            }}>
              Probeer opnieuw
            </button>
          </div>
        </div>
      ) : (
        <main style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1.5vh',
          padding: '2vh 40px 1.5vh',
        }}>
          <SectionTitle title="Klaar voor vertrek" color={C.emerald} />

          <div style={{
            flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid',
            gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
            gridTemplateRows: rowTemplate,
            gap: '2vh 20px', paddingRight: 4,
          }}>
            {ready.length > 0 ? (
              ready.map((r, i) => <ReadyCard key={r.id} r={r} index={i} />)
            ) : (
              <EmptyState
                title="Geen routes klaar voor vertrek"
                text="Zodra een cool check is afgerond, verschijnt de route hier."
              />
            )}
          </div>
        </main>
      )}

      {/* Footer */}
      <footer style={{
        flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 40px', borderTop: `1px solid ${C.border}`, fontSize: 13, color: C.muted,
      }}>
        <span>
          Laatst bijgewerkt: <strong style={{ color: C.slate, fontVariantNumeric: 'tabular-nums' }}>
            {lastUpdate ? fmtTime(lastUpdate) : '—'}
          </strong>
          {' · '}ververst elke {REFRESH_MS / 1000} seconden
        </span>
        {error && loaded && (
          <span style={{ color: C.rose, fontWeight: 600 }}>
            Verbindingsprobleem: laatst bekende gegevens worden getoond
          </span>
        )}
      </footer>
    </div>
  );
}