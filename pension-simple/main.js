const CONFIG = {
  RATE_DECLARED: 0.025,     // 안전형(공시이율) 가정치(연) — 다른 계산기와 동일한 가정
  RATE_INDEX: 0.07,         // 투자형(변액·펀드형) 가정치(연) — 다른 계산기와 동일한 가정
  PAYOUT_YEARS: 20,         // 연금 수령 기간 가정 (기존 노후 연금 계산기와 동일)
  // 국민연금: 2026년 평균 수령액 약 69.8만원(국민연금공단 통계에 물가상승률 반영, KB국민은행 자료).
  NP_BASELINE: 698000,
  // 퇴직연금: "평균 수령액" 공식 통계는 없어서, 연금으로 받는 계좌의 평균 적립금(약 1.4억원,
  // 2024년 퇴직연금통계 · 금융감독원·고용노동부)을 PAYOUT_YEARS(20년)에 나눈 값을 자체 계산해 썼다.
  RETIRE_BASELINE: 583000,
};

// 은퇴 후 희망 생활비를 "현재 소득 대비 비율"로 고를 때 쓰는 값 — 기존 노후 연금 계산기
// STEP1과 동일한 기준(45% / 60% / 80%)을 그대로 가져왔다.
const GOAL_INCOME_RATIO = { min: 0.45, mid: 0.6, high: 0.8 };
const GOAL_HINT_ELEMENT_ID = { min: 'goalMinHint', mid: 'goalMidHint', high: 'goalHighHint' };
const GOAL_TYPE_LABEL = { min: '최소 생활비', mid: '현재 생활 수준 유지', high: '여유로운 생활비', custom: '직접 입력' };

// "5년 뒤에 시작하면 같은 기간을 납입해도 결과가 달라진다" 비교에 쓰는 지연 기간
const DELAY_YEARS = 5;

function $(id) { return document.getElementById(id); }

// 입력창에는 만원 단위로 입력받고(예: 250 → 250만원), 계산은 그대로 원 단위로 하므로
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
// (지금 가진 목돈은 은퇴까지 전체 기간 내내 굴리고, 월 납입액은 납입기간 동안 쌓은 뒤
//  거치기간만큼 더 굴린다. totalYears를 따로 넘기면 목돈의 성장 기간만 그 값을 쓴다 —
//  "5년 뒤에 시작해도" 비교처럼 납입 시작이 늦어져도 목돈은 원래 전체 기간만큼 굴러야 하므로)
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

function bindMoneyInput(el) {
  el.addEventListener('input', () => {
    const digits = el.value.replace(/[^\d]/g, '');
    el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });
}

// 현재 소득을 입력하면, 각 옵션 카드의 안내문구를 "현재 소득수준의 45% ≈ 157만원"처럼
// 실제 금액으로 바꿔준다 (기존 노후 연금 계산기의 updateGoalHints()와 동일한 방식).
function updateGoalHints() {
  const income = parseMoney($('monthlyIncome').value);
  Object.entries(GOAL_INCOME_RATIO).forEach(([goalType, ratio]) => {
    const el = $(GOAL_HINT_ELEMENT_ID[goalType]);
    if (!el) return;
    const label = `현재 소득수준의 ${Math.round(ratio * 100)}%`;
    el.textContent = income ? `${label} ≈ ${formatManwon(income * ratio)}` : label;
  });
}

function selectedGoalType() {
  const el = document.querySelector('input[name="goalType"]:checked');
  return el ? el.value : null;
}

// 선택한 목표(예: "여유로운 생활비 (현재 소득의 80%)")를 설명하는 문구 — 기존 노후 연금
// 계산기의 goalTypeDescription()과 동일한 방식
function goalTypeDescription(goalType) {
  const label = GOAL_TYPE_LABEL[goalType];
  if (!label) return '';
  const ratio = GOAL_INCOME_RATIO[goalType];
  return ratio ? `${label} (현재 소득의 ${Math.round(ratio * 100)}%)` : label;
}

function updateGoalCustomVisibility() {
  $('goalCustomWrap').classList.toggle('hidden', selectedGoalType() !== 'custom');
}

// 선택한 옵션(또는 직접 입력)을 실제 "희망 월 생활비" 금액(원)으로 바꾼다
function resolveTargetIncome() {
  const goalType = selectedGoalType();
  if (!goalType) return null;
  if (goalType === 'custom') {
    const v = parseMoney($('goalCustomAmount').value);
    return v > 0 ? v : null;
  }
  const income = parseMoney($('monthlyIncome').value);
  if (!income) return null;
  return income * GOAL_INCOME_RATIO[goalType];
}

function checkAgeValidity() {
  const currentAge = Number($('currentAge').value);
  const targetAge = Number($('targetAge').value);
  const errorEl = $('ageError');
  if (currentAge > 0 && targetAge > 0 && targetAge <= currentAge) {
    errorEl.classList.remove('hidden');
    return false;
  }
  errorEl.classList.add('hidden');
  return true;
}

function checkPayYearsValidity() {
  const currentAge = Number($('currentAge').value);
  const targetAge = Number($('targetAge').value);
  const payYears = Number($('payYears').value);
  const errorEl = $('payYearsError');
  if (currentAge > 0 && targetAge > 0 && payYears > 0 && payYears > (targetAge - currentAge)) {
    errorEl.classList.remove('hidden');
    return false;
  }
  errorEl.classList.add('hidden');
  return true;
}

// STEP 1(목표 생활비) → STEP 2(소득·나이)로 넘어가기 전에 goalType 선택 여부(및
// 직접 입력 시 금액 입력 여부)를 검증한다.
function goToStep2() {
  const goalType = selectedGoalType();
  const errorEl = $('goalTypeError');
  if (!goalType) {
    errorEl.textContent = '희망하는 은퇴 생활비를 선택해주세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (goalType === 'custom' && !parseMoney($('goalCustomAmount').value)) {
    errorEl.textContent = '희망 월 생활비를 입력해주세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');
  $('step1').classList.add('hidden');
  $('step2').classList.remove('hidden');
  updateGoalHints();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToStep1() {
  $('step2').classList.add('hidden');
  $('step1').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function calc() {
  const targetIncome = resolveTargetIncome();
  const lumpSum = parseMoney($('lumpSum').value);
  const currentAge = Number($('currentAge').value);
  const targetAge = Number($('targetAge').value);
  const payYears = Number($('payYears').value);

  $('goalTypeError').classList.toggle('hidden', !!selectedGoalType());

  if (!targetIncome || !currentAge || !targetAge || !payYears || payYears <= 0) {
    alert('희망 생활비, 현재 나이, 은퇴 희망 나이, 납입 기간을 정확히 입력해주세요.');
    return;
  }
  if (!checkAgeValidity()) return;
  if (!checkPayYearsValidity()) return;

  const totalYears = targetAge - currentAge;
  const idleYears = totalYears - payYears;

  const baseline = CONFIG.NP_BASELINE + CONFIG.RETIRE_BASELINE;
  const shortfall = targetIncome - baseline;

  $('baselineBox').innerHTML =
    `국민연금(예상) <b>${formatManwon(CONFIG.NP_BASELINE)}</b> + 퇴직연금(예상) <b>${formatManwon(CONFIG.RETIRE_BASELINE)}</b> = 월 <b>${formatManwon(baseline)}</b>이 기본으로 준비돼요.`;

  $('goalTypeNote').textContent = goalTypeDescription(selectedGoalType());
  $('goalAmountLabel').textContent = formatMoney(targetIncome);

  // 목돈(lumpSum)이 있으면 은퇴 시점까지 굴렸을 때의 가치를 월 환산해서 부족분에서 미리 빼준다.
  // (안전형 2.5% 가정 — 보수적으로 계산해서, "여유"라고 뜨면 어떤 수익률 가정에서도 실제로 여유가 있도록)
  const lumpMonthlyEquivalent = lumpSum > 0
    ? (lumpSum * growthFactor(CONFIG.RATE_DECLARED / 12, Math.round(totalYears * 12))) / (CONFIG.PAYOUT_YEARS * 12)
    : 0;
  const netShortfall = shortfall - lumpMonthlyEquivalent;

  const gapEl = $('gapMessage');
  if (netShortfall <= 0) {
    gapEl.textContent = `목표 대비 약 ${formatMoney(-netShortfall)} 여유가 예상됩니다.`;
    gapEl.className = 'gap-message good';
  } else {
    gapEl.textContent = `목표 대비 약 ${formatMoney(netShortfall)} 부족할 것으로 예상됩니다.`;
    gapEl.className = 'gap-message critical';
  }

  const achievedBox = $('achievedBox');
  const shortfallBlock = $('shortfallBlock');

  if (shortfall <= 0) {
    achievedBox.classList.remove('hidden');
    shortfallBlock.classList.add('hidden');
    $('result').classList.remove('hidden');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  achievedBox.classList.add('hidden');
  shortfallBlock.classList.remove('hidden');

  // 목표 월 생활비 중 부족한 만큼을, 은퇴 후 PAYOUT_YEARS 동안 매달 받는다고 가정 —
  // 그만큼의 목돈(target lump sum)을 은퇴 시점까지 모으면 되는 구조로 계산한다.
  const targetLumpSum = shortfall * CONFIG.PAYOUT_YEARS * 12;

  const declaredMonthly = requiredMonthly(targetLumpSum, lumpSum, payYears, idleYears, CONFIG.RATE_DECLARED);
  const indexMonthly = requiredMonthly(targetLumpSum, lumpSum, payYears, idleYears, CONFIG.RATE_INDEX);

  $('declaredValue').textContent = declaredMonthly === 0 ? '0원' : formatManwon(declaredMonthly);
  $('indexValue').textContent = indexMonthly === 0 ? '0원' : formatManwon(indexMonthly);

  const alreadyAchieved = declaredMonthly === 0 && indexMonthly === 0;
  if (alreadyAchieved) {
    $('diffNote').innerHTML = '지금 가진 목돈만 굴려도 부족분을 채우실 수 있어요.';
  } else {
    const diff = declaredMonthly - indexMonthly;
    const diffPercent = declaredMonthly > 0 ? Math.round((diff / declaredMonthly) * 100) : 0;
    $('diffNote').innerHTML = diff > 0
      ? `같은 목표라도 수익률에 따라 매달 <strong>${formatManwon(diff)}</strong>(약 ${diffPercent}%) 차이가 납니다.`
      : '';
  }

  // 안전형으로는 부족해도 투자형(연 7%) 가정만으로 목돈이 충분히 불어나 추가 납입 없이
  // 목표를 채우는 경우 — "그럼 실제로 월 얼마까지 준비되는지"를 따로 짚어준다.
  const investAchieveBox = $('investAchieveBox');
  if (!alreadyAchieved && indexMonthly === 0) {
    const lumpMonthlyEquivalentIndex = lumpSum > 0
      ? (lumpSum * growthFactor(CONFIG.RATE_INDEX / 12, Math.round(totalYears * 12))) / (CONFIG.PAYOUT_YEARS * 12)
      : 0;
    const achievableMonthly = baseline + lumpMonthlyEquivalentIndex;
    $('investAchieveText').innerHTML =
      `목돈을 <strong>투자형(연 7% 가정)</strong>으로 운용하시면, 추가 납입 없이도 월 약 <strong>${formatManwon(achievableMonthly)}</strong>까지 준비하실 수 있어요.`;
    investAchieveBox.classList.remove('hidden');
  } else {
    investAchieveBox.classList.add('hidden');
  }

  // "목표까지" 박스: 기존 노후 연금 계산기의 저축 플랜과 같은 형식으로, 투자형(연 7%)
  // 한 가지 가정만으로 "지금 시작하면 얼마" / "5년 뒤에 시작하면 얼마"를 보여준다.
  const delayBox = $('delayBox');
  if (!alreadyAchieved && indexMonthly > 0) {
    $('delayNowText').innerHTML = `지금 시작하면 <strong>${payYears}년</strong> 동안 <strong>월 ${formatManwon(indexMonthly)}</strong> 내면 목표 달성`;

    // "5년 뒤에 시작하면" 비교: 납입 기간(payYears)은 그대로, 시작만 5년 늦어진다고 가정 —
    // 은퇴 나이는 고정이므로 그만큼 거치 기간(idleYears)이 줄어드는 구조.
    // (목돈은 원래 전체 기간(totalYears)만큼 그대로 굴려야 하므로 totalYears로 넘긴다)
    const idleYearsDelayed = idleYears - DELAY_YEARS;
    const laterEl = $('delayLaterText');
    if (idleYearsDelayed >= 0) {
      const indexMonthlyDelayed = requiredMonthly(targetLumpSum, lumpSum, payYears, idleYearsDelayed, CONFIG.RATE_INDEX, totalYears);
      const diff = indexMonthlyDelayed - indexMonthly;
      const diffPercent = Math.round((diff / indexMonthly) * 100);
      laterEl.innerHTML = `<strong>${DELAY_YEARS}년</strong> 뒤에 시작하면 <strong>월 ${formatManwon(indexMonthlyDelayed)}</strong>(${formatManwon(diff)}, ${diffPercent}%) 차이가 나요😢`;
      laterEl.classList.remove('hidden');
    } else {
      laterEl.classList.add('hidden');
    }

    $('delayNoteText').textContent = `투자형(연 복리 ${Math.round(CONFIG.RATE_INDEX * 100)}%가정)으로 계산했습니다.`;
    delayBox.classList.remove('hidden');
  } else {
    delayBox.classList.add('hidden');
  }

  $('result').classList.remove('hidden');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.addEventListener('DOMContentLoaded', () => {
  bindMoneyInput($('monthlyIncome'));
  bindMoneyInput($('goalCustomAmount'));
  bindMoneyInput($('lumpSum'));

  $('monthlyIncome').addEventListener('input', updateGoalHints);
  updateGoalHints();

  document.querySelectorAll('input[name="goalType"]').forEach((el) => {
    el.addEventListener('change', () => {
      updateGoalCustomVisibility();
      $('goalTypeError').classList.add('hidden');
    });
  });

  $('step1NextBtn').addEventListener('click', goToStep2);
  $('step2BackBtn').addEventListener('click', goToStep1);

  $('calcBtn').addEventListener('click', calc);

  ['currentAge', 'targetAge'].forEach((id) => {
    $(id).addEventListener('input', () => { checkAgeValidity(); checkPayYearsValidity(); });
  });
  $('payYears').addEventListener('input', checkPayYearsValidity);
});
