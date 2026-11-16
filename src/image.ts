/** Carga un File como imagen, respetando la orientación EXIF. */
export async function loadFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Recorta (en px de la imagen original) y reduce a maxSide. Devuelve dataURL JPEG. */
export function cropToDataUrl(
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  maxSide = 1568,
  quality = 0.85,
): string {
  const scale = Math.min(1, maxSide / Math.max(rect.w, rect.h));
  const w = Math.round(rect.w * scale);
  const h = Math.round(rect.h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/** Selector de recorte: el usuario arrastra un rectángulo sobre la imagen. */
export function attachCropper(container: HTMLElement, img: HTMLImageElement) {
  container.innerHTML = "";
  container.classList.add("cropper");
  const view = img.cloneNode() as HTMLImageElement;
  const box = document.createElement("div");
  box.className = "crop-box";
  container.append(view, box);

  // selección en fracciones 0-1; por defecto, toda la imagen
  let sel = { x: 0, y: 0, w: 1, h: 1 };
  let start: { x: number; y: number } | null = null;

  const render = () => {
    Object.assign(box.style, {
      left: `${sel.x * 100}%`,
      top: `${sel.y * 100}%`,
      width: `${sel.w * 100}%`,
      height: `${sel.h * 100}%`,
    });
  };

  const pos = (e: PointerEvent) => {
    const r = view.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  container.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    container.setPointerCapture(e.pointerId);
    start = pos(e);
    sel = { x: start.x, y: start.y, w: 0, h: 0 };
    render();
  });
  container.addEventListener("pointermove", (e) => {
    if (!start) return;
    const p = pos(e);
    sel = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    };
    render();
  });
  const end = () => {
    start = null;
    // un toque sin arrastrar = imagen completa
    if (sel.w < 0.05 || sel.h < 0.05) sel = { x: 0, y: 0, w: 1, h: 1 };
    render();
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);
  render();

  return {
    reset() {
      sel = { x: 0, y: 0, w: 1, h: 1 };
      render();
    },
    /** Rectángulo en px de la imagen original. */
    rect() {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      return { x: sel.x * W, y: sel.y * H, w: sel.w * W, h: sel.h * H };
    },
  };
}
