const RADAR_RADIUS_MM = 10_000;
const REF_WIDTH_MM = RADAR_RADIUS_MM * 2;
const REF_HEIGHT_MM = RADAR_RADIUS_MM * 2;

const radarReference = document.querySelector('.radar-reference');
const radarTag = document.querySelector('.radar-tag');
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
  distanceValue.textContent = `${formatMeters(state.distance_mm)} m`;
  angleValue.textContent = `${formatAngle(state.angle_deg)}°`;
  xValue.textContent = `${formatMeters(state.x_mm)} m`;
  yValue.textContent = `${formatMeters(state.y_mm)} m`;
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
  radarTag.style.transform = `translate(-50%, -50%) translate(${xPx}px, ${-yPx}px)`;

  distanceLabel.style.transform = `translate(-50%, -50%) translate(${xPx / 2}px, ${-yPx / 2}px)`;
  distanceLabel.textContent = `${formatMeters(state.distance_mm)} m`;
  distanceLabel.style.opacity = state.distance_mm > 0 ? '1' : '0.6';
}

function formatAngle(value) {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    return '0';
  }
  const rounded = Number(num.toFixed(0));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

function formatMeters(valueMm) {
  const num = Number.parseFloat(valueMm);
  if (Number.isNaN(num)) {
    return '0.00';
  }
  const meters = num / 1000;
  const fixed = meters.toFixed(2);
  return fixed === '-0.00' ? '0.00' : fixed;
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
