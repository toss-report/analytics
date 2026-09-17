const CONFIG = {
  RATE_DECLARED: 0.025, // 공시이율형 가정치(연) — 계산기 페이지와 동일한 가정
  RATE_INDEX: 0.07,     // 변액·펀드형(지수연동형) 가정치(연) — 계산기 페이지와 동일한 가정
};

function $(id) { return document.getElementById(id); }

// 입력창에는 만원 단위로 입력받고(예: 300 → 300만원), 계산은 그대로 원 단위로 하므로
// 여기서 10000을 곱해 원 단위로 변환해둔다.
function parseMoney(str) {
  const n = Number(String(str || '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n * 10000 : 0;
}

function formatMoney(n) {
  const rounded = Math.max(0, Math.round(n || 0));
  return rounded.toLocaleString('ko-KR') + '원';
}

// 1억 미만은 "1,234만원", 1억 이상은 "5억 1,185만원" 형태로 표기
function formatManwon(n) {
  const manwon = Math.max(0, Math.round((n || 0) / 10000));
  if (manwon >= 10000) {
    const eok = Math.floor(manwon / 10000);
    const rest = manwon % 10000;
    return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
  }
  return manwon.toLocaleString('ko-KR') + '만원';
}

// "5년 뒤에 시작하면 같은 기간을 납입해도 결과가 달라진다" 비교에 쓰는 지연 기간
const DELAY_YEARS = 5;

// 월 복리 기준 연금 미래가치 계수: ((1+r)^n - 1) / r  (r=월이율, n=개월수)
function annuityFactor(monthlyRate, months) {
  if (months <= 0) return 0;
  if (monthlyRate <= 0) return months;
  return (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
}

function growthFactor(monthlyRate, months) {
  return Math.pow(1 + monthlyRate, months);
}

// 목표금액을 달성하기 위해 필요한 월 납입액
// (지금 가진 목돈은 "현재 나이 → 목표 나이" 전체 기간 내내 굴리고,
//  월 납입액은 납입기간 동안 쌓은 뒤 거치기간만큼 더 굴린다)
// totalYears를 따로 넘기면 목돈의 성장 기간만 그 값을 쓴다
// ("5년 뒤에 시작해도" 비교처럼, 납입 시작이 늦어져도 목돈은 원래 전체 기간만큼 굴러가야 하므로)
function requiredMonthly(targetAmount, lumpSum, payYears, idleYears, annualRate, totalYears) {
  const monthlyRate = annualRate / 12;
  const payMonths = Math.round(payYears * 12);
  const idleMonths = Math.round(idleYears * 12);
  const lumpMonths = totalYears != null ? Math.round(totalYears * 12) : payMonths + idleMonths;
  if (payMonths <= 0) return null;

  const lumpFv = lumpSum * growthFactor(monthlyRate, lumpMonths);
  const remaining = targetAmount - lumpFv;
  if (remaining <= 0) return 0; // 목돈만으로 이미 목표 달성

  const factor = annuityFactor(monthlyRate, payMonths) * growthFactor(monthlyRate, idleMonths);
  return remaining / factor;
}

// 월 납입액 + 지금 가진 목돈으로 만들어지는 미래가치 (납입기간 + 거치기간 반영)
function futureValue(monthlyAmount, lumpSum, payYears, idleYears, annualRate, totalYears) {
  const monthlyRate = annualRate / 12;
  const payMonths = Math.round(payYears * 12);
  const idleMonths = Math.round(idleYears * 12);
  const lumpMonths = totalYears != null ? Math.round(totalYears * 12) : payMonths + idleMonths;
  if (payMonths <= 0) return lumpSum;

  const lumpFv = lumpSum * growthFactor(monthlyRate, lumpMonths);
  const contribFv = monthlyAmount * annuityFactor(monthlyRate, payMonths) * growthFactor(monthlyRate, idleMonths);
  return lumpFv + contribFv;
}

function bindMoneyInput(el) {
  el.addEventListener('input', () => {
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });
}

function switchTab(target) {
  const isGoal = target === 'goal';
  $('tabGoal').classList.toggle('active', isGoal);
  $('tabSave').classList.toggle('active', !isGoal);
  $('tabGoal').setAttribute('aria-selected', String(isGoal));
  $('tabSave').setAttribute('aria-selected', String(!isGoal));
  $('panelGoal').classList.toggle('hidden', !isGoal);
  $('panelSave').classList.toggle('hidden', isGoal);
}

// 목표 나이가 (현재 나이 + 납입 기간)보다 짧으면 안 됨 — 그 차이가 자동으로 거치 기간이 된다
function checkAgeValidity(currentAgeId, targetAgeId, yearsId, errorId) {
  const currentAge = Number($(currentAgeId).value);
  const targetAge = Number($(targetAgeId).value);
  const years = Number($(yearsId).value);
  const errorEl = $(errorId);
  if (currentAge > 0 && targetAge > 0 && years > 0 && (targetAge - currentAge) < years) {
    errorEl.classList.remove('hidden');
    return false;
  }
  errorEl.classList.add('hidden');
  return true;
}

function calcGoal() {
  const amount = parseMoney($('goalAmount').value);
  const lumpSum = parseMoney($('goalLumpSum').value);
  const currentAge = Number($('goalCurrentAge').value);
  const targetAge = Number($('goalTargetAge').value);
  const years = Number($('goalYears').value);
  if (amount <= 0 || !currentAge || !targetAge || !years || years <= 0) {
    alert('목표 금액과 현재 나이, 목표 나이, 납입 기간을 정확히 입력해주세요.');
    return;
  }
  if (!checkAgeValidity('goalCurrentAge', 'goalTargetAge', 'goalYears', 'goalAgeError')) {
    return;
  }
  const totalYears = targetAge - currentAge;
  const idleYears = totalYears - years;

  const declaredMonthly = requiredMonthly(amount, lumpSum, years, idleYears, CONFIG.RATE_DECLARED);
  const indexMonthly = requiredMonthly(amount, lumpSum, years, idleYears, CONFIG.RATE_INDEX);

  $('goalDeclaredValue').textContent = declaredMonthly === 0 ? '0원' : formatManwon(declaredMonthly);
  $('goalIndexValue').textContent = indexMonthly === 0 ? '0원' : formatManwon(indexMonthly);

  const alreadyAchieved = declaredMonthly === 0 && indexMonthly === 0;
  if (alreadyAchieved) {
    $('goalDiffNote').innerHTML = '지금 가진 목돈만 굴려도 목표 금액을 달성하실 수 있어요.';
  } else {
    const diff = declaredMonthly - indexMonthly;
    const diffPercent = declaredMonthly > 0 ? Math.round((diff / declaredMonthly) * 100) : 0;
    $('goalDiffNote').innerHTML = diff > 0
      ? `같은 목표라도 수익률에 따라 매달 <strong>${formatManwon(diff)}</strong>(약 ${diffPercent}%) 차이가 납니다.`
      : '';
  }

  // 안전형으로는 부족해도 투자형(연 7%) 가정만으로 목돈이 충분히 불어나 추가 납입 없이
  // 목표를 채우는 경우 — "투자형은 목돈만으로 달성 가능"이라는 것과 실제 불어나는 금액을 짚어준다.
  const investAchieveBox = $('goalInvestAchieveBox');
  if (!alreadyAchieved && indexMonthly === 0) {
    const projectedFv = futureValue(0, lumpSum, years, idleYears, CONFIG.RATE_INDEX, totalYears);
    $('goalInvestAchieveText').innerHTML =
      `<strong class="hl-index">투자형</strong>은 지금 가진 목돈만으로도 목표를 달성하실 수 있어요. 투자형으로 굴리면 약 <strong class="hl-index">${formatManwon(projectedFv)}</strong>까지 모이실 것으로 예상돼요.`;
    investAchieveBox.classList.remove('hidden');
  } else {
    investAchieveBox.classList.add('hidden');
  }

  // "5년 뒤에 시작하면" 비교: 납입 기간은 그대로, 시작만 5년 늦어진다고 가정
  // (목돈은 원래 전체 기간(totalYears)만큼 그대로 굴려야 하므로 totalYears를 넘긴다)
  const delayBox = $('goalDelayBox');
  const idleYearsDelayed = idleYears - DELAY_YEARS;
  if (!alreadyAchieved && idleYearsDelayed >= 0) {
    const declaredMonthlyDelayed = requiredMonthly(amount, lumpSum, years, idleYearsDelayed, CONFIG.RATE_DECLARED, totalYears);
    const indexMonthlyDelayed = requiredMonthly(amount, lumpSum, years, idleYearsDelayed, CONFIG.RATE_INDEX, totalYears);
    $('goalDelayText').innerHTML = `<strong>${DELAY_YEARS}년 뒤에</strong> 시작하면, 같은 기간 납입해도 <strong>안전형</strong>은 월 <strong>${formatManwon(declaredMonthlyDelayed)}</strong>, <strong class="hl-index">투자형</strong>은 월 <strong class="hl-index">${formatManwon(indexMonthlyDelayed)}</strong> 내셔야 목표를 달성할 수 있어요.`;
    delayBox.classList.remove('hidden');
  } else {
    delayBox.classList.add('hidden');
  }

  $('goalResult').classList.remove('hidden');
  $('goalResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function calcSave() {
  const amount = parseMoney($('saveAmount').value);
  const lumpSum = parseMoney($('saveLumpSum').value);
  const currentAge = Number($('saveCurrentAge').value);
  const targetAge = Number($('saveTargetAge').value);
  const years = Number($('saveYears').value);
  if (amount <= 0 || !currentAge || !targetAge || !years || years <= 0) {
    alert('월 저축 가능 금액과 현재 나이, 목표 나이, 납입 기간을 정확히 입력해주세요.');
    return;
  }
  if (!checkAgeValidity('saveCurrentAge', 'saveTargetAge', 'saveYears', 'saveAgeError')) {
    return;
  }
  const totalYears = targetAge - currentAge;
  const idleYears = totalYears - years;

  const declaredFv = futureValue(amount, lumpSum, years, idleYears, CONFIG.RATE_DECLARED);
  const indexFv = futureValue(amount, lumpSum, years, idleYears, CONFIG.RATE_INDEX);

  $('saveDeclaredValue').textContent = formatManwon(declaredFv);
  $('saveIndexValue').textContent = formatManwon(indexFv);

  const diff = indexFv - declaredFv;
  const diffPercent = declaredFv > 0 ? Math.round((diff / declaredFv) * 100) : 0;
  $('saveDiffNote').innerHTML = diff > 0
    ? `같은 금액을 모아도 수익률에 따라 <strong>${formatManwon(diff)}</strong>(약 ${diffPercent}%) 차이가 날 수 있습니다.`
    : '';

  // "5년 뒤에 시작하면" 비교: 납입 기간은 그대로, 시작만 5년 늦어진다고 가정
  const delayBox = $('saveDelayBox');
  const idleYearsDelayed = idleYears - DELAY_YEARS;
  if (idleYearsDelayed >= 0) {
    const declaredFvDelayed = futureValue(amount, lumpSum, years, idleYearsDelayed, CONFIG.RATE_DECLARED, totalYears);
    const indexFvDelayed = futureValue(amount, lumpSum, years, idleYearsDelayed, CONFIG.RATE_INDEX, totalYears);
    const declaredLess = declaredFv - declaredFvDelayed;
    const indexLess = indexFv - indexFvDelayed;
    $('saveDelayText').innerHTML = `<strong>${DELAY_YEARS}년 뒤에</strong> 시작하면, 같은 기간 납입해도 <strong>안전형</strong>은 <strong>${formatManwon(declaredLess)}</strong>, <strong class="hl-index">투자형</strong>은 <strong class="hl-index">${formatManwon(indexLess)}</strong> 더 적게 모이게 돼요.`;
    delayBox.classList.remove('hidden');
  } else {
    delayBox.classList.add('hidden');
  }

  $('saveResult').classList.remove('hidden');
  $('saveResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.addEventListener('DOMContentLoaded', () => {
  bindMoneyInput($('goalAmount'));
  bindMoneyInput($('goalLumpSum'));
  bindMoneyInput($('saveAmount'));
  bindMoneyInput($('saveLumpSum'));

  $('tabGoal').addEventListener('click', () => switchTab('goal'));
  $('tabSave').addEventListener('click', () => switchTab('save'));

  $('calcGoalBtn').addEventListener('click', calcGoal);
  $('calcSaveBtn').addEventListener('click', calcSave);

  ['goalCurrentAge', 'goalTargetAge', 'goalYears'].forEach((id) => {
    $(id).addEventListener('input', () => checkAgeValidity('goalCurrentAge', 'goalTargetAge', 'goalYears', 'goalAgeError'));
  });
  ['saveCurrentAge', 'saveTargetAge', 'saveYears'].forEach((id) => {
    $(id).addEventListener('input', () => checkAgeValidity('saveCurrentAge', 'saveTargetAge', 'saveYears', 'saveAgeError'));
  });
});
