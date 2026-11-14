import { useState, useRef, useEffect } from 'react'
import { GRAPHICS } from '../settings'

const OPTION_TABS = [['controls', 'CONTROLS'], ['graphics', 'GRAPHICS'], ['sound', 'SOUND']]
const VOLUMES = [['master', 'Master'], ['effects', 'Effects'], ['music', 'Music']]

// shared by the main menu and the in-game EXIT GAME? pause box
export default function OptionsDialog({ open, onClose, settings, onSettings, playClick }) {
  const [tab, setTab] = useState('controls')
  const ref = useRef(null)
  useEffect(() => {
    if (open) { if (!ref.current?.open) ref.current?.showModal() }
    else if (ref.current?.open) ref.current.close()
  }, [open])
  const isMobile = matchMedia('(pointer: coarse)').matches
  const controls = isMobile ? [
    ['Drive Forward / Back', 'Left Joystick Up / Down'],
    ['Turn Hull', 'Left Joystick Left / Right'],
    ['Aim Turret', 'Drag on Right Side'],
    ['Fire Cannon', 'FIRE Button'],
    ['Coaxial MG (Hold)', 'MG Button / Space (keyboard)'],
    ['Sniper Zoom (Toggle)', 'AIM Button'],
    ['Toggle Map', 'MAP Button'],
    ['Reset Turret to Front', 'Reset Icon ↺'],
    ['Pause / Exit Menu', 'Door Icon'],
  ] : [
    ['Move Forward', 'W'], ['Move Backward', 'S'],
    ['Turn Hull Left', 'A'], ['Turn Hull Right', 'D'],
    ['Aim Turret', 'Mouse Movement'], ['Fire Cannon', 'Left Mouse Button'],
    ['Coaxial MG (Hold)', 'Space'],
    ['Sniper Zoom (Hold)', 'Right Mouse Button'], ['Camera Distance', 'Mouse Wheel'],
    ['Reset Turret to Front', 'R'],
    ['Toggle Map', 'M'], ['Pause / Exit Menu', 'Tab'],
  ]
  return (
    <dialog ref={ref} className="controls-dialog" aria-labelledby="controls-heading" onCancel={onClose} onClose={onClose}>
      <h2 id="controls-heading">Options</h2>
      <div className="options-tabs" role="tablist" aria-label="Options">
        {OPTION_TABS.map(([id, label]) => (
          <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`}
            className={`options-tab${tab === id ? ' active' : ''}`} onClick={() => { playClick(); setTab(id) }}>{label}</button>
        ))}
      </div>
      {tab === 'controls' && <div role="tabpanel" id="panel-controls" aria-labelledby="tab-controls">
        <p className="controls-caption">{isMobile ? 'MOBILE — TOUCH' : 'DESKTOP — KEYBOARD / MOUSE'}</p>
        <label className="setting-row">
          <span>Invert Aim Up / Down</span>
          <input type="checkbox" checked={settings.invertY} onChange={(e) => { playClick(); onSettings({ invertY: e.target.checked }) }} />
          <output>{settings.invertY ? 'ON' : 'OFF'}</output>
        </label>
        <label className="setting-row">
          <span>Aim Sensitivity</span>
          <input type="range" min="25" max="200" step="5" value={settings.sensitivity}
            onChange={(e) => onSettings({ sensitivity: Number(e.target.value) })} onPointerUp={playClick} />
          <output>{settings.sensitivity}%</output>
        </label>
        <dl className="controls-list">
          {controls.map(([action, key]) => <div key={action}><dt>{action}</dt><dd>{key}</dd></div>)}
        </dl>
      </div>}
      {tab === 'graphics' && <div role="tabpanel" id="panel-graphics" aria-labelledby="tab-graphics" className="settings-list">
        <label className="setting-row">
          <span>Render Quality</span>
          <select value={settings.graphics} onChange={(e) => onSettings({ graphics: e.target.value })}>
            {GRAPHICS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
          </select>
        </label>
        <p className="setting-note">HIGH: full resolution + shadows · MEDIUM: lower resolution, softer shadows · LOW: no shadows/antialias, fewer details. Applies from the next battle.</p>
      </div>}
      {tab === 'sound' && <div role="tabpanel" id="panel-sound" aria-labelledby="tab-sound" className="settings-list">
        {VOLUMES.map(([key, label]) => (
          <label key={key} className="setting-row">
            <span>{label}</span>
            <input type="range" min="0" max="100" step="1" value={settings[key]}
              onChange={(e) => onSettings({ [key]: Number(e.target.value) })} onPointerUp={playClick} />
            <output>{settings[key]}</output>
          </label>
        ))}
      </div>}
      <button className="options-btn" autoFocus onClick={() => { playClick(); onClose() }}>BACK</button>
    </dialog>
  )
}
