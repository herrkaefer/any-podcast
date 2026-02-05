'use client'

import { TimeSlider } from '@vidstack/react'

export function TimeSliders() {
  return (
    <TimeSlider.Root className={`
      time-slider group relative inline-flex !h-1 w-full cursor-pointer
      items-center !p-0
    `}
    >
      <TimeSlider.Chapters className="size-full">
        {(cues, forwardRef) =>
          cues.map(cue => (
            <div
              style={{ contain: 'layout style' }}
              key={cue.startTime}
              ref={forwardRef}
            >
              <TimeSlider.Track className={`
                ring-media-focus relative z-0 h-1 w-full bg-black/30
                group-data-[focus]:ring-[1px]
                dark:bg-white/30
              `}
              >
                <TimeSlider.TrackFill className={`
                  bg-media-brand absolute h-1 w-[var(--chapter-fill)] bg-black
                  will-change-[width]
                  dark:bg-white
                `}
                />
                <TimeSlider.Progress className={`
                  absolute z-10 h-1 w-[var(--chapter-progress)] bg-black/40
                  will-change-[width]
                  dark:bg-white/40
                `}
                />
              </TimeSlider.Track>
            </div>
          ))}
      </TimeSlider.Chapters>

      <TimeSlider.Thumb className={`
        absolute top-1/2 left-[var(--slider-fill)] z-20 h-[15px] w-[15px]
        -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#010101]
        bg-black opacity-0 ring-black/40 transition-opacity will-change-[left]
        group-data-[active]:opacity-100
        group-data-[dragging]:ring-4
        dark:border-[#cacaca] dark:bg-white dark:ring-white/40
      `}
      />

      <TimeSlider.Preview className={`
        pointer-events-none mb-2 flex flex-col items-center opacity-0
        transition-opacity duration-200
        data-[visible]:opacity-100
      `}
      >
        <TimeSlider.ChapterTitle className="mt-2 text-sm" />
        <TimeSlider.Value className={`
          rounded-md border bg-white px-2 py-1 text-sm
          dark:bg-black/50
        `}
        />
      </TimeSlider.Preview>
    </TimeSlider.Root>
  )
}
