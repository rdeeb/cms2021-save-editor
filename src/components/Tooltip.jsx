import { useState, useRef, useEffect } from 'react'

export default function Tooltip({ children, content, placement = 'top', delay = 250 }) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const show = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    clearTimeout(timerRef.current)
    setVisible(false)
  }

  if (!content) return children

  return (
    <span
      className="tt-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className={`tt tt-${placement}`} role="tooltip">
          {content}
        </span>
      )}
    </span>
  )
}
