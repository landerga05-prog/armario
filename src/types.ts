export interface DetectedItem {
  id: string;
  categoria: string;
  nombre: string;
  descripcion: string;
  color: string;
  marca: string;
  busqueda: string;
  caja: number[]; // [x1,y1,x2,y2] 0-1000
  thumb?: string; // recorte pequeño de la prenda
}

export interface Match {
  itemId: string;
  titulo: string;
  tienda: string;
  precio: number | null;
  moneda: string;
  url: string;
  tipo: "nuevo" | "segunda_mano";
  exacto: boolean;
  parecido: number;
}

export interface Scan {
  id: string;
  fecha: number;
  thumb: string; // dataURL pequeño
  items: DetectedItem[];
  matches: Record<string, Match[]>;
}

export interface Favorite extends Match {
  savedAt: number;
  itemNombre: string;
  itemThumb?: string;
}
