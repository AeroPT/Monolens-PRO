import React, { useMemo } from 'react';
import { FilterSettings } from '../types';
import { getCurveLut } from '../utils/curveMath';

interface SVGFiltersProps {
  settings: FilterSettings;
}

const SVGFilters: React.FC<SVGFiltersProps> = ({ settings }) => {
  const { blackPoint, whitePoint, midTone, contrast, outputBlack, outputWhite, curvePoints } = settings;

  // Calculate Linear Slope and Intercept for Input Levels
  const range = (whitePoint - blackPoint) / 255;
  const slope = range === 0 ? 1 : 1 / range;
  const intercept = -(blackPoint / 255) * slope;

  // Calculate Linear Slope and Intercept for Contrast
  const contrastSlope = contrast;
  const contrastIntercept = 0.5 * (1 - contrast);

  // Calculate Linear Slope and Intercept for Output Levels
  const outRange = (outputWhite - outputBlack) / 255;
  const outIntercept = outputBlack / 255;

  // Generate Curve LUT String for SVG "tableValues"
  const curveTableValues = useMemo(() => {
    const lut = getCurveLut(curvePoints);
    return lut.join(' ');
  }, [curvePoints]);

  return (
    <svg className="absolute w-0 h-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter id="mono-pro-filter" colorInterpolationFilters="sRGB">
          {/* 1. Desaturate to Grayscale */}
          <feColorMatrix
            type="matrix"
            values="0.2126 0.7152 0.0722 0 0
                    0.2126 0.7152 0.0722 0 0
                    0.2126 0.7152 0.0722 0 0
                    0      0      0      1 0"
            result="gray"
          />

          {/* 2. Apply Input Levels (Black/White point) */}
          <feComponentTransfer in="gray" result="levels_input">
            <feFuncR type="linear" slope={slope} intercept={intercept} />
            <feFuncG type="linear" slope={slope} intercept={intercept} />
            <feFuncB type="linear" slope={slope} intercept={intercept} />
          </feComponentTransfer>

          {/* 3. Apply Gamma (Midtone) */}
          <feComponentTransfer in="levels_input" result="gamma_corrected">
             <feFuncR type="gamma" amplitude="1" exponent={1/midTone} offset="0" />
             <feFuncG type="gamma" amplitude="1" exponent={1/midTone} offset="0" />
             <feFuncB type="gamma" amplitude="1" exponent={1/midTone} offset="0" />
          </feComponentTransfer>

          {/* 4. Apply Contrast */}
          <feComponentTransfer in="gamma_corrected" result="contrast_applied">
            <feFuncR type="linear" slope={contrastSlope} intercept={contrastIntercept} />
            <feFuncG type="linear" slope={contrastSlope} intercept={contrastIntercept} />
            <feFuncB type="linear" slope={contrastSlope} intercept={contrastIntercept} />
          </feComponentTransfer>
          
          {/* 5. Apply Curves (Table Lookup) */}
          <feComponentTransfer in="contrast_applied" result="curve_applied">
            <feFuncR type="table" tableValues={curveTableValues} />
            <feFuncG type="table" tableValues={curveTableValues} />
            <feFuncB type="table" tableValues={curveTableValues} />
          </feComponentTransfer>

          {/* 6. Apply Output Levels */}
          <feComponentTransfer in="curve_applied" result="final">
            <feFuncR type="linear" slope={outRange} intercept={outIntercept} />
            <feFuncG type="linear" slope={outRange} intercept={outIntercept} />
            <feFuncB type="linear" slope={outRange} intercept={outIntercept} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
};

export default SVGFilters;