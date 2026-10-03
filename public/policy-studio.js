const algorithmDetails = {
  'fixed-window': {
    label: 'Fixed Window',
    short: 'Simple, predictable quotas',
    description: 'Counts requests inside a fixed time bucket. It is fast and easy to explain, but a burst can happen at a window boundary.',
    bestFor: 'Simple public APIs and clear quota periods',
    icon: '▣'
  },
  'sliding-window': {
    label: 'Sliding Window Counter',
    short: 'Smoother boundary behavior',
    description: 'Blends the current and previous time windows to reduce boundary spikes while keeping Redis storage compact.',
    bestFor: 'Balanced protection for production-style traffic',
    icon: '◒'
  },
  'token-bucket': {
    label: 'Token Bucket',
    short: 'Controlled bursts with refill',
    description: 'Tokens refill continuously. Requests consume tokens, allowing short bursts while enforcing a sustainable long-term rate.',
    bestFor: 'Burst workloads and latency-sensitive APIs',
    icon: '⬡'
  }
};

function installPolicyStudio() {
  const selector = document.querySelector('#algorithm');
  if (!selector || document.querySelector('#policy-studio')) return;
  const host = selector.closest('.grid-2');
  if (!host) return;
  const studio = document.createElement('div');
  studio.id = 'policy-studio';
  studio.className = 'policy-studio';
  studio.innerHTML = `<div class="section-head studio-heading"><div><h2>Choose the decision engine</h2><p>Select an algorithm to preview its behavior and watch its measured results below.</p></div><span class="badge allowed">LIVE ALGORITHM VIEW</span></div><div class="algorithm-cards">${Object.entries(algorithmDetails).map(([key, item]) => `<button class="algorithm-card" data-algorithm-card="${key}"><span class="algorithm-icon">${item.icon}</span><span class="algorithm-card-copy"><b>${item.label}</b><small>${item.short}</small></span><span class="algorithm-check">✓</span></button>`).join('')}</div><div class="algorithm-insight"><div><span class="eyebrow">SELECTED BEHAVIOR</span><h3 id="algorithm-name"></h3><p id="algorithm-description"></p><span class="algorithm-best" id="algorithm-best"></span></div><div class="algorithm-metrics" id="algorithm-metrics"></div></div><div class="algorithm-compare"><div class="panel-title"><h3>Measured comparison</h3><span>THIS SESSION</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Algorithm</th><th>Requests</th><th>Allowed</th><th>Rejected</th><th>Acceptance</th><th>Avg latency</th></tr></thead><tbody id="algorithm-compare-body"></tbody></table></div></div>`;
  host.parentNode.insertBefore(studio, host);
  const select = document.querySelector('#algorithm');
  studio.querySelectorAll('[data-algorithm-card]').forEach((card) => card.addEventListener('click', () => {
    select.value = card.dataset.algorithmCard;
    updatePolicyStudio();
  }));
  select.addEventListener('change', updatePolicyStudio);
  updatePolicyStudio();
  refreshPolicyMetrics();
}

function updatePolicyStudio() {
  const selected = document.querySelector('#algorithm')?.value || 'fixed-window';
  const detail = algorithmDetails[selected];
  document.querySelectorAll('[data-algorithm-card]').forEach((card) => card.classList.toggle('selected', card.dataset.algorithmCard === selected));
  const name = document.querySelector('#algorithm-name');
  if (!name) return;
  name.textContent = detail.label;
  document.querySelector('#algorithm-description').textContent = detail.description;
  document.querySelector('#algorithm-best').textContent = `Best for: ${detail.bestFor}`;
  renderAlgorithmMetrics(window.rateLimitMetrics || {});
}

function renderAlgorithmMetrics(metrics) {
  const selected = document.querySelector('#algorithm')?.value || 'fixed-window';
  const current = metrics[selected] || { total: 0, accepted: 0, rejected: 0, acceptanceRate: 0, averageLatency: 0, p95Latency: 0 };
  const target = document.querySelector('#algorithm-metrics');
  if (target) target.innerHTML = `<div><b>${current.total}</b><small>requests</small></div><div><b class="good-text">${current.accepted}</b><small>allowed</small></div><div><b class="bad-text">${current.rejected}</b><small>rejected</small></div><div><b>${current.averageLatency} ms</b><small>avg latency</small></div>`;
  const rows = Object.keys(algorithmDetails).map((key) => {
    const item = metrics[key] || { total: 0, accepted: 0, rejected: 0, acceptanceRate: 0, averageLatency: 0 };
    return `<tr class="${key === selected ? 'comparison-selected' : ''}"><td><b>${algorithmDetails[key].label}</b></td><td>${item.total}</td><td class="good-text">${item.accepted}</td><td class="bad-text">${item.rejected}</td><td>${item.acceptanceRate}%</td><td>${item.averageLatency} ms</td></tr>`;
  }).join('');
  const body = document.querySelector('#algorithm-compare-body');
  if (body) body.innerHTML = rows;
}

async function refreshPolicyMetrics() {
  try {
    const live = await fetch('/api/metrics/live').then((response) => response.json());
    window.rateLimitMetrics = live.metrics.byAlgorithm || {};
    renderAlgorithmMetrics(window.rateLimitMetrics);
  } catch (error) {
    // The main dashboard connection indicator reports service availability.
  }
}

const policyStudioObserver = new MutationObserver(installPolicyStudio);
policyStudioObserver.observe(document.querySelector('#app'), { childList: true });
setInterval(() => { if (document.querySelector('#policy-studio')) refreshPolicyMetrics(); }, 2000);
installPolicyStudio();
