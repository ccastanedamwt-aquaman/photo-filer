import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PhotoFiler from './photo-filer'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PhotoFiler />
  </StrictMode>
)