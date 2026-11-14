import { useId } from 'react'

const STAR = 'M50 5 63 35 96 38 71 60 78 94 50 77 22 94 29 60 4 38 37 35Z'

export default function ContinueStars({ remaining, total = 3 }) {
  const id = useId()
  return (
    <div className="continue-stars" role="img" aria-label={`${remaining} of ${total} continues remaining`}>
      {Array.from({ length: total }, (_, i) => i < remaining ? (
        <svg key={i} viewBox="0 0 100 104" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-${i}`} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0" stopColor="#fff8ce" /><stop offset="0.35" stopColor="#ffd568" />
              <stop offset="0.65" stopColor="#c28115" /><stop offset="1" stopColor="#ffdf78" />
            </linearGradient>
          </defs>
          <path d={STAR} fill="#69400e" transform="translate(0 5)" />
          <path d={STAR} fill={`url(#${id}-${i})`} stroke="#ffedac" strokeWidth="1.5" />
          <path d="M50 5 50 52 37 35Z M4 38 50 52 29 60Z M22 94 50 52 50 77Z" fill="#fff5c4" opacity="0.65" />
          <path d="M96 38 50 52 63 35Z M78 94 50 52 71 60Z" fill="#87500c" opacity="0.55" />
        </svg>
      ) : (
        <svg key={i} viewBox="0 0 100 104" className="dim" aria-hidden="true">
          <path d={STAR} fill="#05070b" transform="translate(0 5)" />
          <path d={STAR} fill="#1e242e" stroke="#4a5261" strokeWidth="1.5" />
          <path d="M50 5 50 52 37 35Z M4 38 50 52 29 60Z M22 94 50 52 50 77Z" fill="#2d3542" opacity="0.7" />
          <path d="M96 38 50 52 63 35Z M78 94 50 52 71 60Z" fill="#0e1218" opacity="0.7" />
        </svg>
      ))}
    </div>
  )
}
