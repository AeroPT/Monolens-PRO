import React, { memo, useMemo } from 'react';
import { FilterSettings } from '../types';
import { getCurveLut } from '../utils/curveMath';
import { getBwChannelWeights } from '../utils/bwFilters';

interface SVGFiltersProps {
  settings: FilterSettings;
}

const SVGFilters: React.FC<SVGFiltersProps> = ({ settings }) => {
  const { blackPoint, whitePoint, midTone, contrast, outputBlack, outputWhite, curvePoints, colorFilter } = settings;
  const exposureGain = settings.exposureGain ?? 1.0;

  const [wr, wg, wb] = getBwChannelWeights(colorFilter);
  const channelMatrix = `${wr} ${wg} ${wb} 0 0\n${wr} ${wg} ${wb} 0 0\n${wr} ${wg} ${wb} 0 0\n0 0 0 1 0`;

  // Calculate Linear Slope and Intercept for Input Levels
  const safeSpan = Math.max(1, whitePoint - blackPoint);
  const range = safeSpan / 255;
  const slope = 1 / range;
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
    return lut.map(v => v.toFixed(4)).join(' ');
  }, [curvePoints]);

  return (
    <svg className="absolute w-0 h-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter id="mono-pro-filter" colorInterpolationFilters="sRGB">
          {/* 1. Optical Channel Desaturate to Grayscale */}
          <feColorMatrix
            type="matrix"
            values={channelMatrix}
            result="gray"
          />

          {/* 1b. Exposure Gain (when software fallback is active) */}
          <feComponentTransfer in="gray" result="exposed">
            <feFuncR type="linear" slope={exposureGain} intercept={0} />
            <feFuncG type="linear" slope={exposureGain} intercept={0} />
            <feFuncB type="linear" slope={exposureGain} intercept={0} />
          </feComponentTransfer>

          {/* 2. Apply Input Levels (Black/White point) */}
          <feComponentTransfer in="exposed" result="levels_input">
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

export default memo(SVGFilters);