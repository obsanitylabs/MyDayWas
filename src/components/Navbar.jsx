import { useState, useEffect } from 'react'
import { Logo } from './Logo'
import { APP_URL } from '../config'
import styles from './Navbar.module.css'

const links = [
  { href: '#mission', label: 'Mission' },
  { href: '#how', label: 'How it Works' },
  { href: '#map', label: 'The Map' },
  { href: '#partners', label: 'Partners' },
]

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const closeMobileMenu = () => setIsMobileMenuOpen(false)

  return (
    <>
      <nav className={`${styles.navbar} ${isScrolled ? styles.scrolled : ''}`}>
        <a href="#" className={styles.logo} aria-label="MyDayWas home">
          <Logo />
        </a>

        <div className={styles.links}>
          {links.map((link) => (
            <a key={link.href} href={link.href}>{link.label}</a>
          ))}
          <a href={APP_URL} className={styles.cta}>Write today</a>
        </div>

        <button
          className={styles.mobileToggle}
          onClick={() => setIsMobileMenuOpen(true)}
          aria-label="Open menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </nav>

      <div className={`${styles.mobileMenu} ${isMobileMenuOpen ? styles.active : ''}`}>
        <button className={styles.mobileClose} onClick={closeMobileMenu} aria-label="Close menu">
          &times;
        </button>
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={closeMobileMenu}>{link.label}</a>
        ))}
        <a href={APP_URL} className={styles.cta}>Write today</a>
      </div>
    </>
  )
}
