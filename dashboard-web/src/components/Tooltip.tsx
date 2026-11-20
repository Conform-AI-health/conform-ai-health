import React, { useState, useRef, useEffect } from 'react';
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
  maxWidth = 'max-w-xs w-72',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha o tooltip caso o usuário clique fora no mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  const positionClasses: Record<TooltipPosition, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses: Record<TooltipPosition, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-slate-800 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-slate-800 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-slate-800 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-slate-800 border-y-transparent border-l-transparent',
  };

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

      {isVisible && (
        <div
          role="tooltip"
          className={`absolute z-50 ${positionClasses[position]} ${maxWidth} pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95`}
        >
          <div className="bg-[#0b1329] border border-slate-700/80 rounded-xl p-3 shadow-2xl shadow-black/90 backdrop-blur-md text-left">
            {title && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-white mb-1.5 border-b border-slate-800 pb-1">
                <Info className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                <span>{title}</span>
              </div>
            )}
            <div className="text-[11px] leading-relaxed text-slate-300 font-normal">
              {content}
            </div>
          </div>
          {/* Seta do tooltip */}
          <div
            className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
          />
        </div>
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
