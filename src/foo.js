/**
 * Rectangle-layout manager that lays out rectangles using bitmaps at
 * resolution that, for efficiency, may be somewhat lower than that of
 * the coordinate system for the rectangles being laid out.  `pitchX`
 * and `pitchY` are the ratios of input scale resolution to internal
 * bitmap resolution.
 */

class BitmapRow {
  constructor() {
    this.bits = []
  }
  /**
   *  Given a range of X coordinates, deletes all data dealing with
   *  the features.
   */
  discardRange(left, right) {
    // if completely encloses range, discard everything
    if (left <= this.min && right >= this.max) {
      this.min = undefined
      this.max = undefined
      this.bits = []
      return
    }

    // if overlaps left edge, just leave the
    // bits there and adjust the edge
    if (right >= this.min) {
      const shiftDistance = this.min - right
      this.min = right
      // shift the bits array over
      this.bits.splice(0, shiftDistance)
      return
    }

    // if overlaps right edge, just leave the
    // bits there and adjust the edge
    if (left <= this.max) {
      this.max = left
      return
    }

    // if range is enclosed by us, update the bits
    const leftX = left - this.min
    const rightX = right - this.min
    for (let x = leftX; x <= rightX; x += 1) {
      this.bits[x] = undefined
    }
  }

  setAllFilled(rect) {
    this.allFilled = rect
  }

  getRectAt(x) {
    if (this.allFilled) return this.allFilled
    return (
      this.min !== undefined &&
      x >= this.min &&
      x <= this.max &&
      this.bits[x - this.min]
    )
  }

  isRangeClear(left, right) {
    if (this.min === undefined) return true

    if (this.allFilled && left <= this.max && right >= this.min) return false
    if (this.max > right && this.min < left)
      for (let x = left; x <= right; x += 1) if (this.getRectAt(x)) return false

    return true
  }

  addRect(rect) {
    // TODO
    for (let x = rect.l; x <= rect.r; x += 1) this.bits[x] = rect
  }
}

define(['dojo/_base/declare'], declare =>
  declare(null, {
    /**
     * @param args.pitchX  layout grid pitch in the X direction
     * @param args.pitchY  layout grid pitch in the Y direction
     * @param args.maxHeight  maximum layout height, default Infinity (no max)
     */
    constructor(args) {
      this.pitchX = args.pitchX || 10
      this.pitchY = args.pitchY || 10

      this.displayMode = args.displayMode

      // reduce the pitchY to try and pack the features tighter
      if (this.displayMode === 'compact') {
        this.pitchY = Math.round(this.pitchY / 4) || 1
        this.pitchX = Math.round(this.pitchX / 4) || 1
      }

      this.bitmap = []
      this.rectangles = {}
      this.maxHeight = Math.ceil((args.maxHeight || Infinity) / this.pitchY)
      this.pTotalHeight = 0 // total height, in units of bitmap squares (px/pitchY)
    },

    /**
     * @returns {Number} top position for the rect, or Null if laying out the rect would exceed maxHeight
     */
    addRect(id, left, right, height, data) {
      // if we have already laid it out, return its layout
      if (id in this.rectangles) {
        const storedRec = this.rectangles[id]
        if (storedRec.top === null) return null

        // add it to the bitmap again, since that bitmap range may have been discarded
        this._addRectToBitmap(storedRec, data)
        return storedRec.top * this.pitchY
      }

      const pLeft = Math.floor(left / this.pitchX)
      const pRight = Math.floor(right / this.pitchX)
      const pHeight = Math.ceil(height / this.pitchY)

      const midX = Math.floor((pLeft + pRight) / 2)
      const rectangle = { id, l: pLeft, r: pRight, mX: midX, h: pHeight }
      if (data) rectangle.data = data

      const maxTop = this.maxHeight - pHeight
      for (let top = 0; top <= maxTop; top += 1) {
        if (!this._collides(rectangle, top)) break
      }

      if (top > maxTop) {
        rectangle.top = top = null
        this.rectangles[id] = rectangle
        this.pTotalHeight = Math.max(this.pTotalHeight || 0, top + pHeight)
        return null
      }
      rectangle.top = top
      this._addRectToBitmap(rectangle, data)
      this.rectangles[id] = rectangle
      this.pTotalHeight = Math.max(this.pTotalHeight || 0, top + pHeight)
      return top * this.pitchY
    },

    _collides(rect, top) {
      if (this.displayMode === 'collapsed') return false

      const bitmap = this.bitmap
      // var mY = top + rect.h/2; // Y midpoint: ( top+height  + top ) / 2

      // test exhaustively
      const maxY = top + rect.h
      for (let y = top; y < maxY; y += 1) {
        const row = bitmap[y]
        if (row && !row.isRangeClear(rect.l, rect.r)) {
          return true
        }
      }

      return false
    },

    /**
     * make a subarray if it does not exist
     * @private
     */
    _autovivifyRow(bitmap, y) {
      let row = bitmap[y]
      if (!row) {
        row = new BitmapRow()
        bitmap[y] = row
      }
      return row
    },

    _addRectToBitmap(rect, data) {
      if (rect.top === null) return

      data = data || true
      const bitmap = this.bitmap
      const av = this._autovivifyRow
      const yEnd = rect.top + rect.h
      if (rect.r - rect.l > 20000) {
        // the rect is very big in relation to the view size, just
        // pretend, for the purposes of layout, that it extends
        // infinitely.  this will cause weird layout if a user
        // scrolls manually for a very, very long time along the
        // genome at the same zoom level.  but most users will not
        // do that.  hopefully.
        for (let y = rect.top; y < yEnd; y += 1) {
          av(bitmap, y).setAllFilled(data)
        }
      } else {
        for (let y = rect.top; y < yEnd; y += 1) {
          av(bitmap, y).addRect(rect)
        }
      }
    },

    /**
     *  Given a range of X coordinates, deletes all data dealing with
     *  the features.
     */
    discardRange(left, right) {
      // console.log( 'discard', left, right );
      const pLeft = Math.floor(left / this.pitchX)
      const pRight = Math.floor(right / this.pitchX)
      const bitmap = this.bitmap
      for (let y = 0; y < bitmap.length; y += 1) {
        const row = bitmap[y]
        if (row) row.discardRange(pLeft, pRight)
      }
    },

    hasSeen(id) {
      return !!this.rectangles[id]
    },

    getByCoord(x, y) {
      const pY = Math.floor(y / this.pitchY)
      const row = this.bitmap[pY]
      if (!row) return undefined
      const pX = Math.floor(x / this.pitchX)
      return row.getRectAt(pX)
    },

    getByID(id) {
      const r = this.rectangles[id]
      if (r) {
        return r.data || true
      }
      return undefined
    },

    cleanup() {},

    getTotalHeight() {
      return this.pTotalHeight * this.pitchY
    },
  }))
