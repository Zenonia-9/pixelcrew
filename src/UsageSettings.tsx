import { useEffect, useState } from "react";
import type { UsageHistory } from "../shared/usage-history";
import type { RuntimeStatus } from "../shared/types";
import { AccountUsage } from "./AccountUsage";
const number = (value: number) => value.toLocaleString();
export function UsageSettings({ runtime, onOpenResets }: { runtime: RuntimeStatus; onOpenResets: () => void }) {
  const [range, setRange] = useState("7");
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<UsageHistory>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const end = range === "custom" ? new Date(to + "T23:59:59").getTime() : Date.now();
    const start = range === "custom" ? new Date(from + "T00:00:00").getTime() : end - Number(range) * 86400000;
    fetch(`/api/usage/history?from=${start}&to=${end}`, { signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw Error(value.error); setData(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, from, to, refresh]);
  const max = Math.max(1, ...data?.buckets.map(bucket => bucket.total) || []);
  return <section className="settings-card usage-settings">
    <div className="team-section-heading"><div><h2>Token usage</h2><p>Recorded Codex activity on this laptop, across saved accounts. Cached input is included in input tokens.</p></div><button className="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <div className="usage-range"><label>Time range<select value={range} onChange={event => setRange(event.target.value)}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom dates</option></select></label>{range === "custom" && <><label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></>}</div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {loading ? <p role="status">Loading token history…</p> : data && !error && <>
      <div className="token-totals"><div><small>Total tokens</small><strong>{number(data.totals.total)}</strong></div><div><small>Input</small><strong>{number(data.totals.input)}</strong></div><div><small>Output</small><strong>{number(data.totals.output)}</strong></div><div><small>Cached input</small><strong>{number(data.totals.cached)}</strong></div></div>
      <div className="token-chart" role="img" aria-label={`Token usage graph: ${number(data.totals.total)} tokens across ${data.turns} recorded turns`}>
        <div className="chart-scale"><span>{number(max)}</span><span>0</span></div>
        <svg viewBox="0 0 720 190" preserveAspectRatio="none"><line x1="0" y1="180" x2="720" y2="180" stroke="currentColor" opacity="0.2" />{data.buckets.map((bucket, i) => {
          const width = 720 / data.buckets.length, total = bucket.input + bucket.output, height = total / max * 165, output = bucket.output / max * 165;
          return <g key={bucket.at}><title>{new Date(bucket.at).toLocaleString()}: {number(bucket.total)} tokens (input {number(bucket.input)}, output {number(bucket.output)})</title><rect x={i * width + 2} y={180 - height} width={Math.max(1, width - 4)} height={Math.max(0, height - output)} fill="#8fae8b" /><rect x={i * width + 2} y={180 - output} width={Math.max(1, width - 4)} height={output} fill="#e2bc76" /></g>;
        })}</svg>
      </div>
      <div className="chart-labels"><span>{new Date(data.from).toLocaleString()}</span><span>{new Date(data.to).toLocaleString()}</span></div>
      <p className="chart-legend"><i />Input <i />Output · {data.turns} recorded turns</p>
      {!data.turns && <p>No recorded token usage in this time range.</p>}
      <details><summary>View daily totals</summary><table><thead><tr><th>Time</th><th>Input</th><th>Output</th><th>Total</th></tr></thead><tbody>{data.buckets.map(bucket => <tr key={bucket.at}><td>{new Date(bucket.at).toLocaleString()}</td><td>{number(bucket.input)}</td><td>{number(bucket.output)}</td><td>{number(bucket.total)}</td></tr>)}</tbody></table></details>
    </>}
    <div className="usage-limits-summary"><h2>Account limits & resets</h2><AccountUsage runtime={runtime} expanded onOpenResets={onOpenResets} /></div>
  </section>;
}
