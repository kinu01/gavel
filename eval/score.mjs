// Scoring helpers. Random is computed exactly: the chance of k or more hits when n picks are drawn
// from N open issues of which K were really fixed (hypergeometric tail).
const want = (wanted) => new Set([wanted].flat());

export function hits(picks, outcomes, wanted) {
  const w = want(wanted);
  return picks.filter((n) => w.has(outcomes[n])).length;
}

function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

export function randomTail(N, K, n, k) {
  if (k <= 0) return 1;
  let p = 0;
  for (let x = k; x <= Math.min(n, K); x++) p += Math.exp(logChoose(K, x) + logChoose(N - K, n - x) - logChoose(N, n));
  return Math.min(1, p);
}

export function summarize(picks, outcomes, wanted) {
  const N = Object.keys(outcomes).length;
  const K = Object.values(outcomes).filter((o) => want(wanted).has(o)).length;
  const n = picks.length;
  const k = hits(picks, outcomes, wanted);
  const base = N ? K / N : 0;
  return {
    hits: k,
    of: n,
    base_rate: Number(base.toFixed(3)),
    random_expected: Number((n * base).toFixed(2)),
    lift: n && base ? Number((k / n / base).toFixed(2)) : null,
    p_random_at_least: Number(randomTail(N, K, n, k).toFixed(4)),
  };
}
