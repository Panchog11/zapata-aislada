# Zapata Aislada

Planilla web para el cálculo, la verificación y el dimensionamiento de zapatas aisladas de hormigón armado según **CIRSOC 201-2005**. Incluye el fuste, un modelo 3D, planos DXF y la memoria de cálculo en Word y PDF.

Se abre con cualquier navegador: `zapata_aislada.html` (necesita la carpeta `js/` al lado). Para el 3D y el PDF hace falta conexión a internet, porque Three.js y jsPDF se cargan desde cdnjs.

## Qué hace

- **Suelo y estabilidad (combinaciones de servicio):** tensión máxima y media, área comprimida con despegue biaxial, vuelco, deslizamiento y deslizamiento con torsión Mz.
- **Zapata (combinaciones últimas):**
  - flexión inferior y superior, con cuantías mínima y máxima y separaciones
  - corte unidireccional y punzonado interior, de borde o de esquina, con transferencia de momento
  - aplastamiento, anclajes, banda central y compatibilidad de capas
- **Fuste:**
  - flexo-compresión oblicua por compatibilidad de deformaciones
  - cuantías y corte
  - estribos: diámetro, separación y ramas
  - anclaje de las barras en la zapata
- **Dimensionamiento automático:** busca dimensiones y armaduras, compara alternativas y solo acepta soluciones sin ninguna verificación en «no verifica».
- **Modelo 3D (Three.js):** muestra la geometría real de las barras.
- **Planos DXF R12 (AutoCAD):** planta, cortes A-A y B-B, planilla de armaduras y rótulo, con capas separadas. Para obtener el DWG hay que abrirlo en AutoCAD y guardarlo como DWG.
- **Memoria de cálculo:** exporta a Word (.docx, editable) y a PDF. Para cada verificación incluye la fórmula, los valores reemplazados, el resultado, el criterio y la referencia normativa.

## Estructura

| Archivo | Contenido |
|---|---|
| `zapata_aislada.html` | Interfaz |
| `js/zapata-calc.js` | Cálculo y verificaciones (sin interfaz; también corre en Node) |
| `js/zapata-design.js` | Dimensionamiento automático |
| `js/zapata-dxf.js` | Planos: DXF, vista previa SVG y zip |
| `js/zapata-3d.js` | Visor 3D |
| `js/zapata-report.js` | Memoria de cálculo: pantalla, Word y PDF |
| `js/fuentes/` | DejaVu Sans para el PDF (licencia en `LICENSE-DejaVu.txt`) |
| `tests/zapata.test.js` | Pruebas unitarias con casos de referencia calculados a mano |

## Pruebas

```bash
node --test tests/zapata.test.js
```

## Limitaciones

- Los límites marcados como configurables hay que confirmarlos con el ejemplar vigente del reglamento: §7.6.5, §7.10.5.1, §7.10.5.2 y §7.7.
- No calcula la capacidad portante ni los asentamientos: σadm, μ y los coeficientes de seguridad salen del estudio geotécnico.
- No implementa los requisitos sismorresistentes (INPRES-CIRSOC 103 Parte II), los efectos de segundo orden del fuste ni la fisuración. Cuando corresponden, se informan como «no verificado».

Los resultados deben ser revisados por un profesional responsable antes de usarse en obra.
