import '/pako.min.js'

Array.prototype.fire ??= function(...a){
	for(const f of this) try{ f(...a) }catch(e){ Promise.reject(e) }
}

export const Color = (r, g, b) => r*31.999&31|(g*31.999&31)<<5|(b*31.999&31)<<10

const hex = '0123456789ABCDEF'
export const colorToCss = col => {
	let r = col&31, g = col>>5&31, b = col>>10&31
	r = r<<3|r>>2, g = g<<3|g>>2, b = b<<3|b>>2
	hex[r>>4]+hex[r&15]
	return '#'+hex[r>>4]+hex[r&15]+hex[g>>4]+hex[g&15]+hex[b>>4]+hex[b&15]
}

const qlog = a => { if(a>0x7fffffff)a=0x7fffffff; const lz = Math.clz32(a); return 31-lz+(a<<lz<<1>>>0)/4294967296 }
const BASE_HEAT = qlog(20)
const availCanvases = []

const rangeSort = (a, b) => (a&0xffff)-(b&0xffff)
export class Chunk{
	static LAYERS = 2
	idx = 0; ref = 1
	constructor(){
		const cpuData = new ArrayBuffer(278528)
		this.priceData = new Uint32Array(cpuData, 0, 65536)
		this.ownerData = new Uint8Array(cpuData, 262144, 16384)
		let ctx
		if(availCanvases.length){
			ctx = availCanvases[availCanvases.length-1]
			ctx.canvas.i &= -129>>(this.idx = Math.clz32(ctx.canvas.i)-24)
			if(!ctx.canvas.i) availCanvases.pop()
		}else{
			ctx = document.createElement('canvas').getContext('2d', {alpha:false})
			ctx.canvas.width = 2048
			ctx.canvas.height = Chunk.LAYERS*256
			ctx.canvas.i = 127
			availCanvases.push(ctx)
		}
		this.ctx = ctx
	}
	ready = false
	parse(buf){
		this.ready = true
		const append = buf.v32()<<2, sza = buf.v32()
		const colBlock = pako.inflateRaw(buf.view(sza-append)), colAppend = append ? buf.view(append) : null
		let priceBlock = null, priceAppend = null
		const ownedRanges1 = [], ownedRanges2 = []
		let r1i = 0, r2i = 0, nextOwnedCheck = 0
		if(buf.remaining){
			const szb = buf.v32()
			priceBlock = pako.inflateRaw(buf.view(szb-append))
			if(append) priceAppend = buf.view(append)
			
			let owned = buf.v32()
			if(owned){
				let ownedNow = buf.v32()
				owned -= ownedNow
				while(owned--)
					ownedRanges1.push(buf.u32())
				while(ownedNow--)
					ownedRanges2.push(buf.u32())
				ownedRanges1.sort(rangeSort)
				ownedRanges2.sort(rangeSort)
			}
		}
		for(let i = 0; i < append; i += 4){
			const idx = colAppend[i]<<8|colAppend[i+1], col = colAppend[i+2]<<8|colAppend[i+3]
			colBlock[idx<<1] = col>>8; colBlock[idx<<1|1] = col
			if(priceBlock){
				priceBlock[idx<<2] = priceAppend[i], priceBlock[idx<<2|1] = priceAppend[i+1]
				priceBlock[idx<<2|2] = priceAppend[i+2], priceBlock[idx<<2|3] = priceAppend[i+3]
			}
		}
		
		for(let i = 0; i < 262144; i+=4){
			const col = colBlock[i>>1]<<8|colBlock[i>>1|1]
			const r = col&31, g = col>>5&31, b = col>>10&31
			outCol[i] = r<<3|r>>2; outCol[i+1] = g<<3|g>>2
			outCol[i+2] = b<<3|b>>2
		}
		this.ctx.putImageData(idata, this.idx<<8, 0)
		let ownStateAlpha = 0, ownStateBits = 0
		if(priceBlock){
			this.ownerData.fill(0)
			for(let i = 0; i < 262144; i+=4){
				const j = i>>2
				if(j >= nextOwnedCheck){
					ownStateAlpha = 0; ownStateBits = 0
					while(r1i < ownedRanges1.length){
						const a = ownedRanges1[r1i]
						if(j>=(a>>>16)+1){ r1i++; continue }
						let m = +(j>=(a&0xffff)); ownStateAlpha += m*.25, ownStateBits |= m<<1
						m = (a>>>(m<<4)&0xffff)+m; if(m < nextOwnedCheck) nextOwnedCheck = m
						break
					}
					while(r2i < ownedRanges2.length){
						const a = ownedRanges2[r2i]
						if(j>=(a>>>16)+1){ r2i++; continue }
						let m = +(j>=(a&0xffff)); if(m) ownStateAlpha = .6, ownStateBits |= m
						m = (a>>>(m<<4)&0xffff)+m; if(m < nextOwnedCheck) nextOwnedCheck = m
						break
					}
				}
				const price = (this.priceData[j] = priceBlock[i]<<24|priceBlock[i+1]<<16|priceBlock[i+2]<<8|priceBlock[i+3])>>>0
				let q = qlog(price+10)-BASE_HEAT
				q = q < 0 ? 0 : 896*q/(q+4)
				outCol[i] = q; outCol[i+1] = q-256
				outCol[i+2] = q-512
				if(ownStateAlpha){
					this.ownerData[j>>2] |= ownStateBits<<((j&3)<<1)
					outCol[i] *= 1-ownStateAlpha; outCol[i+1] *= 1-ownStateAlpha
					const b = outCol[i+2]
					outCol[i+2] = b + (255-b)*ownStateAlpha
				}
			}
			this.ctx.putImageData(idata, this.idx<<8, 256)
		}
	}
	priceFor(x, y){
		const idx = x|y<<8
		if(this.ownerData[idx>>2]>>((idx&3)<<1)&1) return 0
		return this.priceData[idx]
	}
	setPixel(x, y, col, price = -1, owned = 0){
		if(typeof col == 'number') col = colorToCss(col)
		this.ctx.fillStyle = col
		this.ctx.fillRect(x|this.idx<<8, y, 1, 1)
		if(price >= 0){
			const idx = x|y<<8
			this.priceData[idx] = price
			let q = qlog(price+10)-BASE_HEAT
			q = q < 0 ? 0 : Math.floor(896*q/(q+4))
			const v = this.ownerData[idx>>2], exp = (idx&3)<<1, m = 3<<exp, vo = +!!(v&m)
			this.ownerData[idx>>2] = v&~m | (vo<<1|owned)<<exp
			const blue = owned ? .6 : vo*.25
			let r = q>255?255:q, g = q<256?0:q>511?255:q-256, b = q<512?0:q>767?255:q-512
			r = Math.floor(r*(1-blue)); g = Math.floor(g*(1-blue)); b = Math.floor(b + (255-b)*blue)
			this.ctx.fillStyle = '#'+hex[r>>4]+hex[r&15]+hex[g>>4]+hex[g&15]+hex[b>>4]+hex[b&15]
			this.ctx.fillRect(x|this.idx<<8, y+256, 1, 1)
		}
	}
	free(){
		const c = this.ctx.canvas
		this.ctx.clearRect(this.idx<<8, 0, 256, 512)
		if(!c.i) availCanvases.push(this.ctx)
		c.i |= 128>>this.idx
	}
}
const idata = new ImageData(256, 256), outCol = idata.data
for(let i = 3; i < 262144; i += 4) outCol[i] = 255