(function () {
  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  function showToast(message) {
    var toast = document.createElement('div');
    toast.className = 'phone-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });
    setTimeout(function () {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', function () {
        toast.remove();
      }, { once: true });
    }, 1800);
  }

  function fallbackCopy(number) {
    var input = document.createElement('input');
    input.value = number;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
      showToast('전화번호가 복사되었습니다: ' + number);
    } catch (e) {
      showToast('전화번호: ' + number);
    }
    input.remove();
  }

  function copyNumber(number) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(number).then(function () {
        showToast('전화번호가 복사되었습니다: ' + number);
      }).catch(function () {
        fallbackCopy(number);
      });
    } else {
      fallbackCopy(number);
    }
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="tel:"]');
    if (!link || isMobile()) return;
    e.preventDefault();
    copyNumber(link.getAttribute('href').replace('tel:', ''));
  });
})();
