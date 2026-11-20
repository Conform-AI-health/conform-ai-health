import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Info } from 'lucide-react';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: React.ReactNode;
  title?: string;
  position?: TooltipPosition;
  children?: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  title,
  position = 'top',
  children,
  className = '',
  maxWidth = 'max-w-[calc(100vw-24px)] w-72 sm:w-80',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    actualPosition: 'top' | 'bottom';
  }>({
    top: 0,
    left: 0,
    arrowLeft: 144,
    actualPosition: 'top',
  });

  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl ? tooltipEl.offsetWidth : 288;
    const tooltipHeight = tooltipEl ? tooltipEl.offsetHeight : 100;

    const gap = 8;
    let actualPos: 'top' | 'bottom' = position === 'bottom' ? 'bottom' : 'top';

    // Se preferido for 'top', mas não houver espaço suficiente acima da viewport, inverte para 'bottom'
    if (position === 'top' && rect.top - tooltipHeight - gap < 12) {
      actualPos = 'bottom';
    } else if (position === 'bottom' && rect.bottom + tooltipHeight + gap > window.innerHeight - 12) {
      actualPos = 'top';
    }

    const top = actualPos === 'top' ? rect.top - tooltipHeight - gap : rect.bottom + gap;

    // Alinhamento horizontal centralizado no elemento âncora
    const anchorCenterX = rect.left + rect.width / 2;
    let left = anchorCenterX - tooltipWidth / 2;

    // Evita corte nas bordas laterais da tela (viewport clamping)
    const margin = 12;
    const minLeft = margin;
    const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));

    // Posição horizontal da seta apontando para a âncora
    const arrowLeft = Math.max(16, Math.min(tooltipWidth - 16, anchorCenterX - clampedLeft));

    setCoords({
      top,
      left: clampedLeft,
      arrowLeft,
      actualPosition: actualPos,
    });
  };

  useLayoutEffect(() => {
    if (isVisible) {
      updatePosition();
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      <div
        className="cursor-help inline-flex items-center"
        onClick={() => setIsVisible((prev) => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={isVisible}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsVisible((prev) => !prev);
          }
        }}
      >
        {children}
      </div>

      {isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 99999,
            }}
            className={`${maxWidth} pointer-events-none transition-opacity duration-150 animate-in fade-in zoom-in-95`}
          >
            <div className="bg-[#0b1329] border border-slate-700/90 rounded-xl p-3.5 shadow-2xl shadow-black/95 backdrop-blur-md text-left">
              {title && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-white mb-1.5 border-b border-slate-800 pb-1.5">
                  <Info className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                  <span>{title}</span>
                </div>
              )}
              <div className="text-[11px] leading-relaxed text-slate-300 font-normal break-words whitespace-normal">
                {content}
              </div>
            </div>
            {/* Seta indicadora do tooltip */}
            <div
              style={{ left: `${coords.arrowLeft}px` }}
              className={`absolute w-0 h-0 -translate-x-1/2 border-4 ${
                coords.actualPosition === 'top'
                  ? 'top-full border-t-[#0b1329] border-x-transparent border-b-transparent'
                  : 'bottom-full border-b-[#0b1329] border-x-transparent border-t-transparent'
              }`}
            />
          </div>,
          document.body
        )}
    </div>
  );
};

export interface InfoTooltipProps {
  title?: string;
  content: React.ReactNode;
  position?: TooltipPosition;
  className?: string;
  iconClassName?: string;
  variant?: 'help' | 'info';
}

/**
 * Componente atalho para exibir um ícone elegante de ajuda (?) ou info (i)
 * que revela a explicação completa ao passar o mouse ou tocar.
 */
export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  content,
  position = 'top',
  className = '',
  iconClassName = 'h-3.5 w-3.5 text-slate-400 hover:text-emerald-400 transition-colors',
  variant = 'help',
}) => {
  const IconComponent = variant === 'help' ? HelpCircle : Info;

  return (
    <Tooltip title={title} content={content} position={position} className={className}>
      <IconComponent className={iconClassName} aria-label={title || 'Informação explicativa'} />
    </Tooltip>
  );
};
