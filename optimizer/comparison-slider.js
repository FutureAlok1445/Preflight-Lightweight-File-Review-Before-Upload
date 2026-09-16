/**
 * optimizer/comparison-slider.js
 * Accessible Before/After visual comparison slider with draggable divider
 * and keyboard navigation controls.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  /**
   * ComparisonSlider(container)
   * Mounts a before/after split slider into `container`.
   */
  function ComparisonSlider(container) {
    let position = 50; // percentage

    const wrapper = document.createElement("div");
    wrapper.className = "cs-wrapper";
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", "Before and after comparison");

    const imgBefore = document.createElement("img");
    imgBefore.className = "cs-before";
    imgBefore.alt = "Original";

    const imgAfter = document.createElement("img");
    imgAfter.className = "cs-after";
    imgAfter.alt = "Optimized";

    function applyClip() {
      imgAfter.style.clipPath = `inset(0 ${100 - position}% 0 0)`;
      imgAfter.style.webkitClipPath = `inset(0 ${100 - position}% 0 0)`;
    }

    const handle = document.createElement("div");
    handle.className = "cs-handle";
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", "Comparison handle — drag to compare original and optimized");
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");
    handle.setAttribute("aria-valuenow", String(position));

    const labelBefore = document.createElement("span");
    labelBefore.className = "cs-label cs-label-before";
    labelBefore.textContent = "Original";
    labelBefore.setAttribute("aria-hidden", "true");

    const labelAfter = document.createElement("span");
    labelAfter.className = "cs-label cs-label-after";
    labelAfter.textContent = "Optimized";
    labelAfter.setAttribute("aria-hidden", "true");

    wrapper.append(imgBefore, imgAfter, handle, labelBefore, labelAfter);
    if (container) container.appendChild(wrapper);

    function setPosition(pct) {
      position = Math.max(0, Math.min(100, pct));
      handle.style.left = `${position}%`;
      handle.setAttribute("aria-valuenow", String(Math.round(position)));
      applyClip();
    }

    setPosition(50);

    // Pointer drag with pointer capture
    let isDragging = false;
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      isDragging = true;
      if (typeof handle.setPointerCapture === "function") {
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    });

    handle.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0) {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setPosition(pct);
      }
    });

    function endDrag(e) {
      if (isDragging) {
        isDragging = false;
        if (typeof handle.releasePointerCapture === "function") {
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch (_) {}
        }
      }
    }

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    // Keyboard support
    handle.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPosition(position - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPosition(position + 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPosition(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setPosition(100);
      }
    });

    return {
      updateImages(beforeSrc, afterSrc) {
        imgBefore.src = beforeSrc || "";
        imgAfter.src = afterSrc || "";
        wrapper.hidden = !afterSrc;
      },
      reset() {
        setPosition(50);
      },
      show() {
        wrapper.hidden = false;
      },
      hide() {
        wrapper.hidden = true;
      },
      getPosition() {
        return position;
      }
    };
  }

  Preflight.comparisonSlider = { ComparisonSlider };
})(typeof window !== "undefined" ? window : globalThis);
