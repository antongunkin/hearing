'use client'

import { useState } from 'react'
import type { Reviews } from '@/src/lib/schema/reviews'

/** A preview picture; the player (and anything it stores) is loaded only on click. */
export function YouTubeEmbed({ video }: { video: Reviews['videos'][number] }) {
  const [playing, setPlaying] = useState(false)
  const id = encodeURIComponent(video.id)
  return (
    <figure className="video">
      <div className="video-frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play video: ${video.title}`}>
            {/* A remote thumbnail of known shape: the frame reserves its space. */}
            <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
            <span className="play" aria-hidden="true" />
          </button>
        )}
      </div>
      <figcaption>
        {video.title}
        <span className="note">{video.channel}</span>
      </figcaption>
    </figure>
  )
}
