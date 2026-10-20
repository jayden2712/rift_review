import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComparison, comparisonTakeaways} from '../public/comparison-view.js';
import {setLanguage} from '../public/i18n.js';

const comparison = {
  coverage: {withDetail: 18, total: 20},
  lane: {
    matches: 18,
    metrics: [
      {
        id: 'csPerMin',
        higherIsBetter: true,
        total: 18,
        ahead: 5,
        behind: 13,
        you: 6.6,
        opponent: 7.0,
        consistentlyAhead: false,
        consistentlyBehind: true,
      },
      {
        id: 'kp',
        higherIsBetter: true,
        total: 18,
        ahead: 13,
        behind: 5,
        you: 0.55,
        opponent: 0.43,
        consistentlyAhead: true,
        consistentlyBehind: false,
      },
      {
        id: 'damageShare',
        higherIsBetter: true,
        total: 0,
        ahead: 0,
        behind: 0,
        you: null,
        opponent: null,
        consistentlyAhead: false,
        consistentlyBehind: false,
      },
    ],
  },
  self: {
    available: true,
    role: 'Mid',
    recentN: 5,
    baselineN: 7,
    metrics: [
      {
        id: 'deathsPer30',
        higherIsBetter: false,
        typical: 3.45,
        recent: 5.43,
        change: 0.57,
        notable: true,
        better: false,
      },
      {
        id: 'kp',
        higherIsBetter: true,
        typical: 0.51,
        recent: 0.52,
        change: 0.02,
        notable: false,
        better: true,
      },
    ],
  },
  winLoss: {
    available: true,
    wins: 13,
    losses: 7,
    metrics: [
      {
        id: 'deathsPer30',
        higherIsBetter: false,
        win: 3.51,
        loss: 5.18,
        effect: -0.98,
        notable: true,
        favorsWins: true,
      },
      {
        id: 'goldPerMin',
        higherIsBetter: true,
        win: 446,
        loss: 430,
        effect: 0.23,
        notable: false,
        favorsWins: true,
      },
    ],
  },
};

test('takeaways put a consistent lane deficit first, then wins vs losses and recent form', () => {
  const lines = comparisonTakeaways(comparison);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /CS \/ phút/);
  assert.match(lines[0], /13\/18/);
  assert.match(lines[1], /Chết \/ 30 phút/);
  assert.match(lines[1], /3,5/);
  assert.match(lines[2], /5 trận gần nhất/);
  assert.deepEqual(
    comparisonTakeaways({
      ...comparison,
      lane: {matches: 0, metrics: []},
      self: {available: false},
      winLoss: {available: false},
    }),
    [],
  );
});

test('the comparison section renders all three lenses with formatted values and coverage', () => {
  const html = renderComparison(comparison);
  assert.match(html, /So với đối thủ cùng đường/);
  assert.match(html, /Hơn ở 5\/18 trận/);
  assert.match(html, /is-behind/);
  assert.match(html, /55%/);
  assert.doesNotMatch(html, /% sát thương của đội/);
  assert.match(html, /Thắng và thua khác nhau ở đâu/);
  assert.match(html, /13 thắng · 7 thua/);
  assert.match(html, /Mid/);
  assert.match(html, /Gần như không đổi/);
  assert.match(html, /18\/20 trận có dữ liệu chi tiết/);
});

test('missing lenses explain what is needed, in English too', () => {
  setLanguage('en');
  try {
    const html = renderComparison({
      coverage: {withDetail: 2, total: 2},
      lane: {matches: 0, metrics: []},
      self: {available: false, role: 'Mid', recentN: 2, baselineN: 0},
      winLoss: {available: false, wins: 2, losses: 0},
    });
    assert.match(html, /Compared with your lane opponent/);
    assert.match(html, /at least 3 wins and 3 losses/);
    assert.match(html, /at least 10 games/);
  } finally {
    setLanguage('vi');
  }
});

test('champion table shows lane gaps with a sign and hides champions below three games', async () => {
  const {renderChampionBreakdown} = await import('../public/comparison-view.js');
  const html = renderChampionBreakdown([
    {
      champion: 'Jayce',
      games: 5,
      wins: 5,
      kda: 6.55,
      deathsPer30: 3.2,
      csPerMin: 7.4,
      laneGames: 5,
      csDiffPerMin: 0.8,
      goldDiffPerMin: 52,
    },
    {
      champion: 'TwistedFate',
      games: 5,
      wins: 4,
      kda: 3.46,
      deathsPer30: 4.1,
      csPerMin: 6.1,
      laneGames: 4,
      csDiffPerMin: -1.2,
      goldDiffPerMin: -10,
    },
  ]);
  assert.match(html, /Theo tướng/);
  assert.match(html, /Jayce/);
  assert.match(html, /100%/);
  assert.match(html, /\+0,8/);
  assert.match(html, /−1,2/);
  assert.match(html, /class="[^"]*loss-text[^"]*">−1,2/);
  assert.match(renderChampionBreakdown([]), /ít nhất 3 trận/);
});
