const REF_WIDTH_MM = 1210;
const REF_HEIGHT_MM = 810;

const radarReference = document.querySelector('.radar-reference');
const radarLine = document.querySelector('.radar-line');
const radarTag = document.querySelector('.radar-tag');
const radarAngle = document.querySelector('.radar-angle');
const distanceLabel = document.querySelector('.distance-label');

const distanceValue = document.querySelector('#distanceValue');
const angleValue = document.querySelector('#angleValue');
const xValue = document.querySelector('#xValue');
const yValue = document.querySelector('#yValue');
const timestampValue = document.querySelector('#timestampValue');

let latestState = null;

function subscribeToStream() {
  const source = new EventSource('/events');
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'state') {
        applyState(payload.data);
      }
    } catch (error) {
      console.error('Failed to parse event payload', error);
    }
  };

  source.onerror = () => {
    console.warn('SSE connection interrupted, retrying…');
  };
}

function applyState(state) {
  latestState = state;
  updateTelemetry(state);
  renderRadar(state);
}

function updateTelemetry(state) {
  distanceValue.textContent = `${formatNumber(state.distance_mm)} mm`;
  angleValue.textContent = `${formatNumber(state.angle_deg)}°`;
  xValue.textContent = `${formatNumber(state.x_mm)} mm`;
  yValue.textContent = `${formatNumber(state.y_mm)} mm`;
  timestampValue.textContent = formatTimestamp(state.ts);
}

function renderRadar(state) {
  if (!radarReference) {
    return;
  }

  const rect = radarReference.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const mmPerPxX = REF_WIDTH_MM / rect.width;
  const mmPerPxY = REF_HEIGHT_MM / rect.height;
  const mmPerPx = Math.max(mmPerPxX, mmPerPxY);

  const xPx = state.x_mm / mmPerPx;
  const yPx = state.y_mm / mmPerPx;
  const distancePx = state.distance_mm / mmPerPx;
  const rotationDeg = -state.angle_deg;

  radarLine.style.width = `${Math.max(distancePx, 0)}px`;
  radarLine.style.transform = `translate(-50%, -50%) rotate(${rotationDeg}deg)`;

  radarAngle.style.transform = `translate(-50%, -50%) rotate(${rotationDeg}deg)`;

  radarTag.style.transform = `translate(-50%, -50%) translate(${xPx}px, ${-yPx}px)`;

  distanceLabel.style.transform = `translate(-50%, -50%) translate(${xPx / 2}px, ${-yPx / 2}px)`;
  distanceLabel.textContent = `${formatNumber(state.distance_mm)} mm`;
  distanceLabel.style.opacity = state.distance_mm > 0 ? '1' : '0.6';
}

function formatNumber(value) {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    return '0';
  }
  const rounded = Number(num.toFixed(0));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

function formatTimestamp(ts) {
  if (!ts) {
    return '—';
  }
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
      return ts;
    }
    return date.toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (error) {
    return ts;
  }
}

window.addEventListener('resize', () => {
  if (latestState) {
    renderRadar(latestState);
  }
});

subscribeToStream();
