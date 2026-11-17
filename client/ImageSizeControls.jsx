import React, { useEffect, useState } from 'react';
import { Button } from './ui.jsx';
import { dimensionsOf, resizeImage, resetImageSize } from './image-size.js';
export default function ImageSizeControls({ attributes, onChange, imageKey, compact = false }) {
  const values = dimensionsOf(attributes),
    [keep, setKeep] = useState(values.keep);
  useEffect(() => setKeep(dimensionsOf(attributes).keep), [imageKey]);
  useEffect(() => {
    if (values.height.value) setKeep(false);
  }, [values.height.value]);
  return (
    <div className={'ce-image-size ' + (compact ? 'ce-image-size-compact' : '')}>
      <label>
        Width
        <div className="ce-dimension-field">
          <input
            aria-label="Image width"
            type="number"
            min="0.1"
            step="any"
            value={values.width.value}
            placeholder="Auto"
            onChange={(event) =>
              onChange(
                resizeImage(attributes, 'width', event.target.value, values.width.unit, keep),
              )
            }
          />
          <select
            aria-label="Image width unit"
            value={values.width.unit}
            onChange={(event) =>
              onChange(
                resizeImage(
                  attributes,
                  'width',
                  values.width.value || '100',
                  event.target.value,
                  keep,
                ),
              )
            }
          >
            <option value="px">px</option>
            <option value="%">%</option>
          </select>
        </div>
      </label>
      <label>
        Height
        <div className="ce-dimension-field">
          <input
            aria-label="Image height"
            type="number"
            min="0.1"
            step="any"
            value={keep ? '' : values.height.value}
            placeholder="Auto"
            disabled={keep}
            onChange={(event) =>
              onChange(resizeImage(attributes, 'height', event.target.value, 'px', false))
            }
          />
          <span>px</span>
        </div>
      </label>
      <label className="ce-image-proportions">
        <input
          aria-label="Keep image proportions"
          type="checkbox"
          checked={keep}
          onChange={(event) => {
            setKeep(event.target.checked);
            if (event.target.checked) onChange(resizeImage(attributes, 'height', '', 'px', true));
          }}
        />
        Keep proportions
      </label>
      <Button
        onClick={() => {
          setKeep(true);
          onChange(resetImageSize(attributes));
        }}
      >
        Reset size
      </Button>
    </div>
  );
}
