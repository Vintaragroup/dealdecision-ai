import { useEffect, useState } from 'react';

interface AnimatedCounterProps {
  end: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

export function AnimatedCounter({ end, duration = 1000, decimals = 0, suffix = '', prefix = '' }: AnimatedCounterProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    const startValue = 0;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentCount = startValue + (end - startValue) * easeOutQuart;
      
      setCount(currentCount);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [end, duration]);

  return (
    <span>
      {prefix}{count.toFixed(decimals)}{suffix}
    </span>
  );
}
