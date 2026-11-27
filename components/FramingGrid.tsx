import React, { memo } from 'react';

export type GridMode = 'off' | '3x3' | '4x4' | 'phi' | 'diag';

export const GRID_MODE_ORDER: GridMode[] = ['off', '3x3', '4x4', 'phi', 'diag'];

interface FramingGridProps {
  mode: GridMode;
  visible: boolean;
}

const FramingGrid: React.FC<FramingGridProps> = ({ mode, visible }) => {
  if (mode === 'off') return null;

  const lineStroke = 'rgba(255, 255, 255, 0.36)';
  const accentStroke = 'rgba(255, 255, 255, 0.52)';

  const renderLines = () => {
    if (mode === '3x3') {
      const stops = ['33.333%', '66.667%'];
      return (
        <>
          {stops.map(pos => (
            <React.Fragment key={pos}>
              <line
                x1={pos}
                y1="0%"
                x2={pos}
                y2="100%"
                stroke={lineStroke}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0%"
                y1={pos}
                x2="100%"
                y2={pos}
                stroke={lineStroke}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </React.Fragment>
          ))}
        </>
      );
    }

    if (mode === '4x4') {
      const stops = ['25%', '50%', '75%'];
      return (
        <>
          {stops.map(pos => (
            <React.Fragment key={pos}>
              <line
                x1={pos}
                y1="0%"
                x2={pos}
                y2="100%"
                stroke={pos === '50%' ? accentStroke : lineStroke}
                strokeWidth="1"
                strokeDasharray={pos === '50%' ? '4 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0%"
                y1={pos}
                x2="100%"
                y2={pos}
                stroke={pos === '50%' ? accentStroke : lineStroke}
                strokeWidth="1"
                strokeDasharray={pos === '50%' ? '4 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            </React.Fragment>
          ))}
        </>
      );
    }

    if (mode === 'phi') {
      // Golden ratio (1 : 1.618) -> 38.197% and 61.803%
      const stops = ['38.197%', '61.803%'];
      return (
        <>
          {stops.map(pos => (
            <React.Fragment key={pos}>
              <line
                x1={pos}
                y1="0%"
                x2={pos}
                y2="100%"
                stroke={lineStroke}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0%"
                y1={pos}
                x2="100%"
                y2={pos}
                stroke={lineStroke}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </React.Fragment>
          ))}
        </>
      );
    }

    // 'diag': Diagonals + subtle center cross
    return (
      <>
        <line
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
          stroke={lineStroke}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="100%"
          y1="0%"
          x2="0%"
          y2="100%"
          stroke={lineStroke}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="50%"
          y1="0%"
          x2="50%"
          y2="100%"
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth="1"
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0%"
          y1="50%"
          x2="100%"
          y2="50%"
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth="1"
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
        />
      </>
    );
  };

  return (
    <svg
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full z-[5] pointer-events-none transition-opacity duration-200 drop-shadow-[0_0_1px_rgba(0,0,0,0.75)] ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      preserveAspectRatio="none"
    >
      {renderLines()}
    </svg>
  );
};

export default memo(FramingGrid);
