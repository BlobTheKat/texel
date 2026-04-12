import { Color, colorToCss } from "./chunk.js"
import * as API from './state.js'
import { addToTransaction, MAX_TRANSACTION_DIMENSIONS, MAX_TRANSACTION_PIXELS, MAX_ZOOM, bucketFillTransaction, commitTransaction, transactionSize, offsetTransaction, balanceChanged, balance, transactionPrice, transactionPriceChanged, MIN_DEPOSIT, WITHDRAW_FEE, checkoutDeposit, checkoutWithdraw, requestAuth, tokenChanged, token, setTokenLocal, ifloat, iint, getChunk, getTransactionPixels, clearTransaction, refreshConnection, connectionStateChanged, CONNECTION, API_ENDPOINT, clearToken, transactionOutOfScreen, transactionPixelOwnershipSummary } from "./state.js"

let lastRedraw = 0, needRedraw = () => { lastRedraw = 0 }
API.worldChanged.push(needRedraw)

//function handleError(e){ console.error(e) }
//window.addEventListener('error', e => { handleError(e.error); e.preventDefault() })
//window.addEventListener('unhandledrejection', e => { handleError(e.reason); e.preventDefault() })
const $ = document.querySelector.bind(document)
$.all = document.querySelectorAll.bind(document)

/** @type {CanvasRenderingContext2D} */
const ctx = $('#canvas').getContext('2d', {alpha:false})
const info = $('#info'), place = $('#place'), paletteEl = $('#palette'), paletteEnd = $('#gap')

paletteEl.addEventListener('wheel', e => { paletteEl.scrollLeft += e.deltaY }, {passive:true})

info.onfocus = () => {
	info.selectionStart = 0
	info.selectionEnd = -1>>>1
	keys = 0
}
info.onchange = () => {
	info.blur()
	const matches = info.value.match(/-?\d+(\.\d*)?/g)
	if(!matches || matches.length < 2 || matches.length > 4) return
	clickAnim = 0
	camX = (Math.floor(matches[0])||0)+(matches[0].includes('.')?0:0.5)
	camY = (Math.floor(matches[1])||0)+(matches[1].includes('.')?0:0.5)
	if(matches.length > 2) camZoom = camTargetZoom = Math.max(Math.min((256/matches[2]||1), MAX_ZOOM), MIN_ZOOM), easeZoom = 0
	needRedraw()
	for(let i = 0; i < 4; i++) Sound.play(scratch, i*.5+1, 1, i*.035)
}

let drawing = false
function showPalette(show = true){
	(drawing = show) ? paletteEl.classList.add('shown') : paletteEl.classList.remove('shown')
	if(!show) fillEl.classList.remove('selected'), fill = false, colorPicker.style.display = ''
}

function capturePointerInputs(el, fn){
	el.addEventListener('pointerdown', e => { if(!e.isTrusted) return; el.setPointerCapture(e.pointerId); e.preventDefault(); fn(e) })
	el.addEventListener('pointermove', e => { e.preventDefault(); if(el.hasPointerCapture(e.pointerId)) fn(e) })
	el.addEventListener('pointerup', e => { e.preventDefault(); el.releasePointerCapture(e.pointerId) })
	el.addEventListener('pointercancel', e => { el.releasePointerCapture(e.pointerId) })
}
function captureClick(el, fn, pvd = true){
	let ptrs = new Set()
	el.addEventListener('pointerdown', e => { if(!e.isTrusted) return; if(!e.button) ptrs.add(e.pointerId); pvd&&e.preventDefault() })
	el.addEventListener('pointerup', e => { if(!e.isTrusted) return; pvd&&e.preventDefault(); if(ptrs.has(e.pointerId)) ptrs.delete(e.pointerId), fn(e) })
	el.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId) })
}

const connectingOverlay = $('#connecting')
connectionStateChanged.push(state => {
	if(state == CONNECTION.OPEN){ connectingOverlay.style.display = 'none'; return }
	connectingOverlay.style.display = ''
	state == CONNECTION.CONNECTING ? connectingOverlay.classList.remove('failed') : connectingOverlay.classList.add('failed')
	connectingOverlay.firstElementChild.textContent = state ? 'Connecting...' : 'Connection failed!'
})
captureClick(connectingOverlay, () => {
	if(connectingOverlay.classList.contains('failed'))
		refreshConnection()
})
refreshConnection()

if(Date.now() < +localStorage.welcomeDismissed) $('#welcome-panel').remove()
else captureClick($('#welcome-button'), () => {
	Sound.play(note, 4)
	$('#welcome-panel').remove()
	localStorage.welcomeDismissed = Date.now() + 86400e3
})

const defaultPalette = '000 111 222 200 210 220 120 020 021 022 012 002 102 202 201'
const palette = []
if(typeof localStorage.palette == 'string') for(const p of localStorage.palette.split(',')) palette.push(p&65535)
else for(let i = 0; i < defaultPalette.length; i+=4)
	palette.push(Color(defaultPalette[i]*.45+.05, defaultPalette[i+1]*.45+.05, defaultPalette[i+2]*.45+.05))

function savePalette(){
	if(palette.length) localStorage.setItem('palette', palette.join(','))
	else localStorage.removeItem('palette')
}

const eyeDropper = window.EyeDropper ? new EyeDropper() : null
if(!eyeDropper) $('#eyedropper').classList.add('disabled')
else captureClick($('#eyedropper'), e => void eyeDropper.open().then(result => {
	colorPreview.firstElementChild.value = result.sRGBHex
	hexChanged()
}, err => {}))
let brightness = 0.5, hue = 0, sat = 1, colorPickerCol = 0
const colorPicker = $('#color-picker'), brightnessSlider = $('#brightness-slider'), colorWheel = $('#color-wheel'), colorPreview = $('#color-preview')
capturePointerInputs(brightnessSlider, e => {
	colorPicker.style.setProperty('--l', brightness = Math.min(1, Math.max(0, e.layerX / e.currentTarget.clientWidth)))
	calcColor()
})
const hexChanged = () => {
	let col = colorPreview.firstElementChild.value
	if(col[0] == '#') col = col.slice(1)
	let i = parseInt(col, 16)
	switch(col.length){
		// Do not add break statements, fallthrough is intentional
		case 4: i >>>= 4
		case 3: i = (i&15)*17<<8 | ((i>>4&15)*17)<<16 | ((i>>8&15)*17)<<24
		case 8: i >>>= 8
		case 6:
			setColorPickerCol(Color((i>>16&255)/255, (i>>8&255)/255, (i&255)/255))
	}
}
colorPreview.firstElementChild.addEventListener('input', hexChanged)
const setAB = () => {
	let r = Math.max(0, Math.min(Math.abs(hue-3)-1,1)), g = Math.max(0, Math.min(Math.abs(hue+(hue<2)*6-5)-1,1)), b = Math.max(0, Math.min(Math.abs(hue-(hue>=4)*6-1)-1,1))
	const asat = (1-sat)*255
	colorPicker.style.setProperty('--a', `rgb(${r*asat|0},${g*asat|0},${b*asat|0})`)
	colorPicker.style.setProperty('--b', `rgb(${(r+(1-r)*sat)*255|0},${(g+(1-g)*sat)*255|0},${(b+(1-b)*sat)*255|0})`)
}
function setColorPickerCol(col){
	colorPickerCol = col
	const r = (col&31)/31, g = (col>>5&31)/31, b = (col>>10&31)/31
	// Convert RGB to HSB
	const max = Math.max(r, g, b), min = Math.min(r, g, b)
	sat = 1 - max + min
	brightness = min / sat
	if(sat == 0) brightness = 0.5
	if(max == r) hue = (g - b) / (max - min)
	else if(max == g) hue = 2 + (b - r) / (max - min)
	else hue = 4 + (r - g) / (max - min)
	if(hue < 0) hue += 6
	if(sat == 1) hue = 0
	colorPicker.style.setProperty('--l', brightness)
	colorPicker.style.setProperty('--col', colorToCss(colorPickerCol))
	colorPreview.dataset.color = '0x' + colorPickerCol.toString(16).padStart(4, '0').toUpperCase()
	const mag = (.99 - sat / 1.0625) * .5
	colorPicker.style.setProperty('--x', Math.sin(hue * Math.PI / 3)*mag)
	colorPicker.style.setProperty('--y', Math.cos(hue * Math.PI / 3)*-mag)
	setAB()
	if(document.activeElement != colorPreview.firstElementChild) colorPreview.firstElementChild.value = colorToCss(colorPickerCol)
}
colorPreview.firstElementChild.addEventListener('change', e => { colorPreview.firstElementChild.value = colorToCss(colorPickerCol) })
function calcColor(){
	let r = Math.max(0, Math.min(Math.abs(hue-3)-1,1)), g = Math.max(0, Math.min(Math.abs(hue+(hue<2)*6-5)-1,1)), b = Math.max(0, Math.min(Math.abs(hue-(hue>=4)*6-1)-1,1))
	r += (brightness-r)*sat; g += (brightness-g)*sat; b += (brightness-b)*sat
	colorPickerCol = ((b*31|0)<<10)|((g*31|0)<<5)|(r*31|0)
	const cssCol = colorToCss(colorPickerCol)
	colorPicker.style.setProperty('--col', cssCol)
	colorPreview.firstElementChild.value = cssCol
	colorPreview.dataset.color = '0x' + colorPickerCol.toString(16).padStart(4, '0').toUpperCase()
}
calcColor()
capturePointerInputs(colorWheel, e => {
	let hsX = e.layerX / e.currentTarget.clientWidth - .5
	let hsY = e.layerY / e.currentTarget.clientHeight - .5
	sat = Math.sqrt(hsX*hsX+hsY*hsY)*2
	if(sat > 1) hsX /= sat, hsY /= sat, sat = 1
	colorPicker.style.setProperty('--x', hsX); colorPicker.style.setProperty('--y', hsY)
	sat = Math.min((.99 - sat) * 1.0625, 1)
	hue = Math.atan2(-hsX, hsY) / Math.PI * 3 + 3
	setAB()
	calcColor()
})

function makePaletteColor(col, insertBefore = null){
	const d = document.createElement('div')
	d.classList.add('palette-color')
	d.style.backgroundColor = d.title = colorToCss(col)
	d.style.setProperty('--contrast', (col&31)+(col>>5&31)+(col>>10&31) < 31 ? '#fff7' : '#0007')
	d.dataset.color = col
	if(insertBefore) paletteEl.firstElementChild.insertBefore(d, insertBefore)
	return d
}

captureClick($('#banding'), e => { colorPicker.classList.toggle('banding') })
captureClick($('#color-cancel'), e => { colorPicker.style.display = ''; Sound.play(scratch) })
captureClick($('#color-accept'), e => {
	colorPicker.style.display = ''
	const i = palette.indexOf(colorPickerCol)
	if(i >= 0){
		const el = paletteEl.firstElementChild.children[i+2]
		if(selected != el) selectEl(el)
	}else{
		const i = palette.indexOf(selectedCol)
		palette.splice(i+1, 0, colorPickerCol)
		selectEl(makePaletteColor(colorPickerCol, selected.nextElementSibling))
		savePalette()
	}
})

const toastEl = $('#toasts'), fillEl = $('#fill')
function toast(msg, color = '#e22', onclick){
	const el = document.createElement('span')
	el.classList.add('toast')
	el.style.backgroundColor = color
	el.append(msg)
	if(onclick) el.style.cursor = 'pointer', el.onpointerup = e => { e.preventDefault(); onclick() }, el.style.pointerEvents = 'auto'
	toastEl.append(el)
	if(toastEl.childElementCount > 3) toastEl.firstElementChild.remove()
	return el
}

for(const col of palette) makePaletteColor(col, paletteEnd)
let selectedCol = palette[0] ?? -1, prevSelected = $('#eraser'), selected = prevSelected.nextElementSibling, fill = false
selected.classList.add('selected')

function selectEl(el){
	let col = el.dataset.color
	if(col == 'fill'){
		fill = el.classList.toggle('selected')
		Sound.play(swoosh, fill*.5+1)
		return
	}else if(col == 'add'){
		if(selectedCol >= 0) setColorPickerCol(selectedCol)
		colorPicker.style.display = 'flex'
		Sound.play(swoosh, 1.5)
		return
	}else if(col == 'rem'){
		if(selectedCol < 0) return
		const s = selected
		selected = selected.previousElementSibling
		s.remove()
		if(prevSelected == s) prevSelected = $('#eraser')
		selected.classList.add('selected')
		Sound.play(scratch)
		toast(`Removed ${colorToCss(selectedCol)}`, '#2b2')
		const i = palette.indexOf(selectedCol)
		palette.splice(i, 1)
		selectedCol = +selected.dataset.color
		savePalette()
		return
	}
	col = +col
	if(selected) selected.classList.remove('selected')
	if(col == selectedCol){
		const t = selected; selected = prevSelected, prevSelected = t
		selectedCol = +selected.dataset.color
	}
	else prevSelected = selected, selected = el, selectedCol = +col
	selected.classList.add('selected')
	Sound.play(note, Math.random()*0.5+1)
}

captureClick(paletteEl, e => {
	e.preventDefault()
	const el = e.target.closest('.palette-color')
	if(el) selectEl(el)
})

function openAccountPanel(){
	$.all('.panel.shown').forEach(el => el.classList.remove('shown'))
	if(token)
		accountPanel.classList.add('shown')
	else
		loginPanel.classList.add('shown')
}

const slippageInput = $('#slippage'), maxPriceOutput = $('#max-price'), placeButton = $('#place-button')
const placingOwned = $('#placing-owned'), placingPrevOwned = $('#placing-prev-owned'), placingNew = $('#placing-new'), dismissPlacePanel = $('#dismiss-place-panel')

dismissPlacePanel.checked = !+localStorage.placePanelDismissed
dismissPlacePanel.addEventListener('update', () => {
	localStorage.placePanelDismissed = +!dismissPlacePanel.checked
})

let slippage = +(localStorage.slippage ??= '0.01')
slippageInput.addEventListener('update', () => {
	const v = slippageInput.value*.01
	if(v >= 0) localStorage.slippage = slippage = v
	else localStorage.slippage = slippage = '0', slippageInput.value = '0.0'
	calcSlippage()
})
slippageInput.value = slippage*100
if(!slippageInput.value.includes('.')) slippageInput.value += '.0'
let panelMaxTransactionPrice = 0
function calcSlippage(){
	placeButton.textContent = '$' + (transactionPrice/1e4).toFixed(4)
	panelMaxTransactionPrice = Math.ceil((1+slippage)*transactionPrice)
	maxPriceOutput.textContent = '$' + (panelMaxTransactionPrice/1e4).toFixed(4)
}

captureClick(placeButton, () => {
	submitTransaction(panelMaxTransactionPrice)
	placePanel.classList.remove('shown')
})

captureClick(place, e => {
	needRedraw()
	e.preventDefault()
	if(!drawing){
		Sound.play(scratch)
		if(camZoom < 512) showPalette()
		else clickX = camX, clickY = camY, clickAnim = -1
		return
	}
	localStorage.welcomeDismissed = 'Infinity'
	if(!transactionSize()) return void Sound.play(buzz), toast('Click on the canvas to place pixels', '#e92')
	if(!token) return void Sound.play(buzz), openAccountPanel()
	if(dismissPlacePanel.checked || e.target.closest('#place-options')){
		const sz = transactionSize()
		if(!sz){
			Sound.play(buzz)
			return
		}
		Sound.play(note, 4)
		placePanel.classList.add('shown')
		placePanel.firstElementChild.firstChild.textContent = `Place ${sz} pixel${sz>1?'s':''}`
		const {owned, prevOwned, new: new_} = transactionPixelOwnershipSummary()
		if(!owned) placingOwned.parentElement.style.display = 'none'
		else placingOwned.parentElement.style.display = '', placingOwned.textContent = owned<0?'???':owned
		if(!prevOwned) placingPrevOwned.parentElement.style.display = 'none'
		else placingPrevOwned.parentElement.style.display = '', placingPrevOwned.textContent = prevOwned<0?'???':prevOwned
		if(!new_) placingNew.parentElement.style.display = 'none'
		else placingNew.parentElement.style.display = '', placingNew.textContent = new_<0?'???':new_
		calcSlippage()
		return
	}
	submitTransaction(Math.ceil(transactionPrice*(1+slippage)))
})

function submitTransaction(max){
	if(balance < transactionPrice || !token) return void Sound.play(buzz), openAccountPanel()
	commitTransaction((px, price) => {
		if(!px){
			Sound.play(buzz)
			toast(`Failed to place pixels`)
			if(placePanel.classList.contains('shown'))
				calcSlippage()
			return
		}
		Sound.play(chime)
		toast(`Placed ${px} pixels for $${(price/10000).toFixed(4)}`, '#25e')
	}, max)
	if(lastFillUndo) lastFillUndo = null, lastFillToast.remove(), lastFillToast = null
}

let layer = 0, grid = true
const heatmapEl = $('#heatmap'), gridEl = $('#grid')
function setLayer(l = 1-layer){
	if(layer == (layer = l)) return
	layer ? heatmapEl.classList.add('selected') : heatmapEl.classList.remove('selected')
	Sound.play(scratch, 1 + layer)
	needRedraw()
}
function setGrid(g = !grid){
	if(grid == (grid = g)) return
	grid ? gridEl.classList.add('selected') : gridEl.classList.remove('selected')
	Sound.play(scratch, 1 + grid)
	needRedraw()
}

document.addEventListener('pointerup', e => { e.target.closest('a[href]') && Sound.play(scratch, 2) })

const accountPanel = $('#account-panel'), loginPanel = $('#login-panel'), tokensPanel = $('#tokens-panel'), tokensPanelUserCount = $('#user-tokens'), tokensPanelContainer = $('#tokens-container'), placePanel = $('#place-panel')
captureClick(heatmapEl, () => { setLayer() })
captureClick(gridEl, () => { setGrid() })
captureClick($('#help'), () => { Sound.play(scratch, 2); window.open('/about', '_blank') })
captureClick($('#account'), () => { Sound.play(scratch, 2); openAccountPanel() })
captureClick($('#close-account-panel'), () => { Sound.play(scratch); accountPanel.classList.remove('shown') })
captureClick($('#close-login-panel'), () => { Sound.play(scratch); loginPanel.classList.remove('shown') })
captureClick($('#close-tokens-panel'), () => { Sound.play(scratch); tokensPanel.classList.remove('shown'); accountPanel.classList.add('shown') })
captureClick($('#close-place-panel'), () => { Sound.play(scratch); placePanel.classList.remove('shown') })
captureClick($('#tokens'), () => {
	Sound.play(scratch, 2)
	if(!token) return
	accountPanel.classList.remove('shown')
	tokensPanel.classList.add('shown')
	window.getSelection().removeAllRanges()
	refreshTokenList()
})
const revokeAllFn = filt => () => {
	// Sign out of all devices
	Sound.play(scratch, 2)
	if(token) fetch(API_ENDPOINT + '/revoke_all/' + token + filt).then(a => a.text()).then(res => {
		if(token && res == '0') return
		delete localStorage.texel_token
		location.reload()
	})
}
const remNode = $('.remove')
captureClick(remNode, revokeAllFn('?filter=user'))
captureClick($('#revoke-all'), revokeAllFn(''))
captureClick($('#new-token'), () => {
	if(!token) return
	Sound.play(scratch, 2)
	fetch(API_ENDPOINT + '/new_token/' + token).then(a => a.text()).then(res => {
		if(res){
			const el = elementForToken(res)
			tokensPanelContainer.insertBefore(el, devicesTokenElement)
			el.classList.add('flash2')
			el.offsetHeight
			el.classList.remove('flash2')
		}
		if(token) refreshTokenList()
	})
})

const devicesTokenElement = tokensPanelContainer.lastElementChild
const elementForToken = (tok) => {
	const el = document.createElement('div')
	el.classList.add('token')
	el.dataset.censored = tok.slice(0, 6) + '******.************'
	el.textContent = tok
	const rem2 = remNode.cloneNode(true)
	el.appendChild(rem2)
	captureClick(el, e => {
		Sound.play(scratch, 2)
		if(rem2.contains(e.target)) return fetch(API_ENDPOINT + '/revoke/' + tok).then(a=>a.text()).then(res => { if(res == '1') el.remove() })
		navigator.clipboard?.writeText(tok)
		const r = document.createRange()
		r.selectNodeContents(el)
		const sel = window.getSelection()
		sel.removeAllRanges()
		sel.addRange(r)
		el.classList.add('flash')
		el.offsetHeight
		el.classList.remove('flash')
	}, false)
	return el
}

const refreshTokenList = () => fetch(API_ENDPOINT + '/list_tokens/' + token).then(a => a.text()).then(res => {
	res = res.split('\n')
	const total = res.shift()-1
	tokensPanelUserCount.textContent = total < 1 ? '' : ' and '+total+' others'
	const prev = new Map
	const last = tokensPanelContainer.lastElementChild
	for(const ch of tokensPanelContainer.children)
		if(ch != last) prev.set(ch.textContent, ch)
	let ib4 = tokensPanelContainer.firstElementChild
	for(const tok of res){
		const el = prev.get(tok)
		if(el){
			prev.delete(tok)
			if(ib4 == el)
				ib4 = prev.values().next().value ?? last
		}else tokensPanelContainer.insertBefore(elementForToken(tok), ib4)
	}
	for(const el of prev.values()) el.remove()
})

const bin = new Image()
bin.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAQAAAAIlLYPAAAAo0lEQVR42u2WMQrEMBAD/f8f7Gvn4IoLgiMDauKAtYVtVqwmTuO1seBSN+CqPr5HIKuKz1MRH6cu3hE83hEoFeOLyvgegb4eB3j6F2wlAOid8k3mzLEMc7NzgFnzb3cADsABcADAAOAWAAFIn99BrunyO8g1XQfgAOwLQDQZJj0KkL1ZIx4f3gIUHn6Sro3HugIgMgCv5Qge3yOYJFz1nnfwVx+tJmELhjettwAAAABJRU5ErkJggg'

const MIN_ZOOM = 4
let camX = 0, camY = 0, camZoom = 512, camTargetZoom = 1024, easeZoom = 5
let clickX = 0, clickY = 0, clickAnim = 0
let lastT = 0, w = 0, h = 0
let selectBoxLineOffset = 0
const rAF = requestAnimationFrame
rAF(function f(t){
	t *= .001
	const dt = Math.min(.1, t-lastT); lastT = t
	rAF(f)
	if(t - lastRedraw < .16) return
	if(keys){
		clickAnim = 0
		const moveBy = camZoom*dt*.4
		if(keys&1) camY -= moveBy
		if(keys&2) camY += moveBy
		if(keys&4) camX -= moveBy
		if(keys&8) camX += moveBy
		needRedraw()
	}else needRedraw(t)
	if(document.activeElement != info){
		const x = iint(p0x*camZoom+camX), y = iint(p0y*camZoom+camY)
		
		if(info.disabled = !!layer){
			const p = getChunk(x, y)?.priceData[(x&255)|(y&255)<<8]??-1
			info.value = `Pixel price: ${p>=0?'$'+(p/1e4).toFixed(4):'unknown'}`
		}else info.value = `x=${x}, y=${y} (${(256/camZoom).toFixed(2+(camZoom>1024))}x)`
	}
	if(camZoom > 512 && drawing) showPalette(false)
	ctx.resetTransform(), ctx.clearRect(0, 0, w, h)
	if(clickAnim){
		const diffX = ifloat(clickX-camX), diffY = ifloat(clickY-camY), diffZ = camZoom>64?64-camZoom:0
		let d = dt*6
		const r = diffX*diffX+diffY*diffY+diffZ*diffZ*.04
		if(r < .01){
			d = Math.min((1-r*30)*d, 1)
			if(clickAnim < 0){
				clickAnim = 0
			}else if((clickAnim -= dt) < 0){ clickAnim = 0; d = 1 }
		}
		if(r < 2 && !drawing) showPalette()
		camX += diffX*d
		camY += diffY*d
		camTargetZoom = camZoom += diffZ*d
		easeZoom = 0
		needRedraw()
	}else if(easeZoom){
		const diff = (camTargetZoom-camZoom)*Math.min(1, dt*easeZoom)
		camZoom += diff
		camX -= diff*p0x
		camY -= diff*p0y
		if(Math.abs(diff/camZoom) < 1e-4) camZoom = camTargetZoom, easeZoom = 0
		needRedraw()
	}
	const zoom = Math.sqrt(w*h) / camZoom
	ctx.imageSmoothingEnabled = zoom<1.414
	const w2 = w/(zoom+zoom), h2 = h/(zoom+zoom)
	camX = ifloat(camX); camY = ifloat(camY)
	API.setArea(camX-w2, camX+w2, camY-h2, camY+h2)
	const LINE_RADIUS = Math.sqrt(camZoom)/128
	if(grid&&LINE_RADIUS*zoom>.5){
		ctx.setTransform(zoom, 0, 0, -zoom, .5*w, .5*h)
		for(const {0: pos, 1: chunk} of API.chunks){
			const x = ifloat((pos<<8&0xff00)-camX), y = ifloat((pos&0xff00)-camY)
			ctx.drawImage(chunk.ctx.canvas, chunk.idx<<8, layer<<8, 256, 256, x, y, 256, 256)
		}
	}else{
		// Ensure no AA gaps which would normally be covered up by the gridlines
		const f = 256*zoom, hw = w*.5, hh = h*.5
		ctx.setTransform(1, 0, 0, -1, 0, h)
		for(const {0: pos, 1: chunk} of API.chunks){
			let x0 = ifloat((pos<<8&0xff00)-camX)*zoom+hw, y0 = ifloat((pos&0xff00)-camY)*zoom+hh
			const w = Math.round(x0+f) - (x0 = Math.round(x0)), h = Math.round(y0+f) - (y0 = Math.round(y0))
			ctx.drawImage(chunk.ctx.canvas, chunk.idx<<8, layer<<8, 256, 256, x0, y0, w, h)
		}
		ctx.setTransform(zoom, 0, 0, -zoom, .5*w, .5*h)
	}
	const GRID_SIZE = camZoom > 513 ? 256 : camZoom > 65 ? 16 : 1
	if(grid){
		const x0 = Math.ceil((camX-w2-LINE_RADIUS)/GRID_SIZE)*GRID_SIZE, x1 = camX+w2+LINE_RADIUS
		const y0 = Math.ceil((camY-h2-LINE_RADIUS)/GRID_SIZE)*GRID_SIZE, y1 = camY+h2+LINE_RADIUS
		ctx.fillStyle = `hsl(0deg, 0%, ${Math.sin(t*.25)*25+25}%)`
		for(let x = x0; x < x1; x+=GRID_SIZE){
			let a = x&255?x&15?0.25:0.5:1
			ctx.globalAlpha = a
			a *= LINE_RADIUS
			ctx.fillRect(x-camX-a, -h2, a+a, h2+h2)
		}
		for(let y = y0; y < y1; y+=GRID_SIZE){
			let a = y&255?y&15?0.25:0.5:1
			ctx.globalAlpha = a
			a *= LINE_RADIUS
			ctx.fillRect(-w2, y-camY-a, w2+w2, a+a)
		}
	}
	if(clickAnim > 0){
		ctx.globalAlpha = clickAnim
		ctx.lineWidth = LINE_RADIUS+LINE_RADIUS
		const x = ifloat(clickX-camX-.5), y = ifloat(clickY-camY-.5)
		ctx.strokeStyle = '#fff'
		ctx.strokeRect(x-LINE_RADIUS, y-LINE_RADIUS, 1+ctx.lineWidth, 1+ctx.lineWidth)
		ctx.strokeStyle = '#000'
		ctx.strokeRect(x+LINE_RADIUS, y+LINE_RADIUS, 1-ctx.lineWidth, 1-ctx.lineWidth)
	}
	ctx.globalAlpha = 1
	if(layer) ctx.fillStyle = '#0f05'
	const bounds = getTransactionPixels((x, y, _col, cssCol) => {
		if(!layer) ctx.fillStyle = cssCol
		ctx.fillRect(ifloat(x-camX)+.015625, ifloat(y-camY)+.015625, .96875, .96875)
	})
	
	if(bounds){
		const price = bounds.price/1e4
		place.dataset.amount = `${bounds.count} ${bounds.count*price > 1e5 ? 'px' : bounds.count > 1 ? 'pixels' : 'pixel'}: $${Math.floor(price)}`
		place.dataset.amount2 = (price%1).toFixed(price > 9999.9999 ? price>=99999.9995 ? 2 : 3 : 4).slice(1)
		place.style.fontSize = price >= 10 ? '1.1rem' : ''
		const top = iint(camY-h2*.65 - bounds.minY) >= 0, right = iint(camX-w2 - bounds.minX + 1) >= 0
		const w = bounds.maxX-bounds.minX&0xffff, h = bounds.maxY-bounds.minY&0xffff
		const black = t%2|0
		ctx.strokeStyle = ctx.fillStyle = black?'#000':'#fff'
		const fontSize = w>1 ? 1 : .5
		ctx.font = `bold ${fontSize}px Ubuntu`
		ctx.textAlign = right ? 'right' : 'left'
		const txt = w + ' x ' + h, x = ifloat((right?bounds.maxX:bounds.minX)-camX), y = ifloat((top?bounds.maxY+.25:bounds.minY-.95)-camY)
		ctx.scale(1, -1)
		ctx.fillText(txt, x, -y + (top?.2:-.9)*(1-fontSize), w)
		if(selectedCol < 0)
			ctx.drawImage(bin, black<<5, 0, 32, 32, x+(right?.1:-.1), (top?.15:-.05)-y, right ? .8 : -.8, -.8)
		ctx.scale(1, -1)

		const lw = ctx.lineWidth = Math.max(camZoom/256, .25)
		ctx.setLineDash([lw*4, lw*4])
		ctx.lineDashOffset = selectBoxLineOffset = (selectBoxLineOffset % (lw*8)) + dt*.75
		ctx.strokeRect(ifloat(bounds.minX-camX), ifloat(bounds.minY-camY), ifloat(bounds.maxX-bounds.minX), ifloat(bounds.maxY-bounds.minY))
		needRedraw()
		ctx.setLineDash([])
	}else delete place.dataset.amount
})

let p0 = -1, p1 = -1, p0x = 0, p0y = 0, p1x = 0, p1y = 0
let p0m = 0, holdTimer = 0, pendown = -1

let lastBuzz = 0, lastFillUndo = null, lastFillToast = null

function tryToPlace(vol = 1, cont = false, col = selectedCol){
	const x = iint(p0x*camZoom+camX)
	const y = iint(p0y*camZoom+camY)
	const res = addToTransaction(x, y, col)
	if(res == 2){
		vol && Sound.play(scratch, 1.75+Math.random()*.5, vol*.3)
		if(lastFillUndo) lastFillUndo = null, lastFillToast.remove(), lastFillToast = null
	}else if(!res){
		const t = performance.now()
		if(!cont || t - lastBuzz > 500){
			Sound.play(buzz), lastBuzz = t
			if(transactionOutOfScreen()){
				let t = toast(`You have pixels placed out of screen. Click to clear them`, '#e22', () => {
					t.remove()
					clearWithUndo()
				})
			}else toast(`Maximum size for a single transaction is ${MAX_TRANSACTION_DIMENSIONS}x${MAX_TRANSACTION_DIMENSIONS} or ${MAX_TRANSACTION_PIXELS} pixels`)
		}
	}else if(res == 1 && selectedCol < 0 && !cont){
		const bounds = vol == 1 ? getTransactionPixels() : null
		if(bounds){
			const izoom2 = .5*camZoom / Math.sqrt(w*h)
			const top = iint(camY-(h*izoom2)*.65 - bounds.minY) >= 0, right = iint(camX-(w*izoom2) - bounds.minX + 1) >= 0
			if(x == (right ? bounds.maxX : bounds.minX-1) && y == (top ? bounds.maxY : bounds.minY-1))
				return clearWithUndo()
		}
		vol && Sound.play(buzz)
		toast('You may only erase pixels in your current drawing')
	}
}

function clearWithUndo(){
	const res = clearTransaction((rm, undo) => {
		lastFillUndo = undo
		lastFillToast = toast(rm+' pixels erased. Click to undo', '#c2c', undoFill)
	})
	res == 2 ? Sound.play(swoosh, 1.5) : Sound.play(buzz)
}

function undoFill(){
	if(lastFillUndo){
		lastFillUndo()
		Sound.play(scratch)
		lastFillUndo = null
		lastFillToast.remove()
		lastFillToast = null
		//fill = true
		//fillEl.classList.add('selected')
	}
}

ctx.canvas.oncontextmenu = e => e.preventDefault()
let lastButton = -1
ctx.canvas.addEventListener('pointerdown', e => {
	if(!e.isTrusted || e.pointerId === -1) return
	if(document.activeElement !== document.body) document.activeElement.blur()
	e.preventDefault()
	needRedraw()
	const z = 1/Math.sqrt(innerWidth*innerHeight)
	const x = (e.clientX-innerWidth*.5)*z, y = -(e.clientY-innerHeight*.5)*z
	if(p0 == -1){
		p0 = e.pointerId, p0x = x, p0y = y, p0m = 0
		if(drawing && !holdTimer && pendown == -1 && !fill) holdTimer = setTimeout(() => {
			holdTimer = 0
			if(p0 !== e.pointerId || p1 !== -1 || p0m > .007) return
			Sound.play(scratch)
			pendown = p0
			tryToPlace(0, true, (lastButton = e.button) ? -1 : selectedCol)
		}, 600)
	}else if(p1 == -1) p1 = e.pointerId, p1x = x, p1y = y, p0m = Infinity
})

const pointerup = e => {
	if(!e.isTrusted || e.pointerId === -1) return
	e.preventDefault()
	needRedraw()
	if(p0 == e.pointerId){
		p0 = p1
		holdTimer && (clearTimeout(holdTimer), holdTimer = 0)
		if(p0m < 0.003 && pendown != e.pointerId){
			if(drawing){
				if(fill){
					const x = iint(p0x*camZoom+camX)
					const y = iint(p0y*camZoom+camY)
					if(lastFillUndo) lastFillUndo = null, lastFillToast.remove(), lastFillToast = null
					const res = bucketFillTransaction(x, y, selectedCol, (count, undo) => {
						fill = false; fillEl.classList.remove('selected')
						lastFillUndo = undo; lastFillToast = toast(`Filled ${count} pixels. Click to undo`,  '#c2c', undoFill)
					})
					if(res == 3) Sound.play(swoosh, 1.5+Math.random(), 0.5)
					else if(res == 2) Sound.play(scratch, 1.75+Math.random()*.5)
					else if(!res) toast(`Maximum size for a single transaction is ${MAX_TRANSACTION_PIXELS} pixels`), Sound.play(buzz)
				}else tryToPlace(1, false, (lastButton = e.button) ? -1 : selectedCol)
			}else{
				Sound.play(scratch)
				clickX = iint(p0x*camZoom+camX)+.5; clickY = iint(p0y*camZoom+camY)+.5
				clickAnim = 1
			}
		}
		if(p1 != -1) p0x = p1x, p0y = p1y, p1 = -1
	}else if(p1 == e.pointerId) p1 = -1
	if(pendown == e.pointerId) pendown = -1
}
ctx.canvas.addEventListener('pointerup', pointerup)
ctx.canvas.addEventListener('pointerleave', pointerup)

ctx.canvas.addEventListener('pointermove', e => {
	if(!e.isTrusted || e.pointerId === -1) return
	e.preventDefault()
	needRedraw()
	const z = 1/Math.sqrt(innerWidth*innerHeight)
	if(pendown == e.pointerId){
		const c = e.getCoalescedEvents?.() ?? []
		if(!c.length) c.push(e)
		for(const e2 of c){
			p0x = (e2.clientX-innerWidth*.5)*z, p0y = -(e2.clientY-innerHeight*.5)*z
			tryToPlace(.5, true, lastButton ? -1 : selectedCol)
		}
		return
	}
	const x = (e.clientX-innerWidth*.5)*z, y = -(e.clientY-innerHeight*.5)*z
	if(p0 == -1){ p0x = x; p0y = y; needRedraw(); return }
	clickAnim = 0
	if(p1 == -1 && p0 == e.pointerId){
		camX -= (x - p0x) * camZoom
		camY -= (y - p0y) * camZoom
		p0m += Math.abs(x-p0x) + Math.abs(y-p0y)
		p0x = x; p0y = y
	}else{
		const o0x = p0x, o0y = p0y, o1x = p1x, o1y = p1y
		if(p0 == e.pointerId) p0x = x, p0y = y
		else if(p1 == e.pointerId) p1x = x, p1y = y
		else return
		const n0x = p0x, n0y = p0y, n1x = p1x, n1y = p1y
		const ox = o0x-o1x, oy = o0y-o1y, nx = n0x-n1x, ny = n0y-n1y
		const zoom = Math.sqrt((ox*ox+oy*oy)/(nx*nx+ny*ny))
		const omx = o1x+ox*.5, omy = o1y+oy*.5, nmx = n1x+nx*.5, nmy = n1y+ny*.5
		camX += omx*camZoom; camY += omy*camZoom
		camZoom = Math.max(Math.min(camZoom*zoom, MAX_ZOOM), MIN_ZOOM)
		camX -= nmx*camZoom; camY -= nmy*camZoom
		camTargetZoom = camZoom; easeZoom = 0
	}
})
ctx.canvas.addEventListener('wheel', e => {
	if(!e.isTrusted) return
	clickAnim = 0
	camTargetZoom = Math.max(Math.min(camTargetZoom*1.003 ** e.deltaY, MAX_ZOOM), MIN_ZOOM)
	easeZoom = Math.abs(Math.log2(camTargetZoom/camZoom)) >= 1.25 ? 10 : 0
	if(!easeZoom){
		const diff = camTargetZoom - camZoom
		camZoom = camTargetZoom
		camX -= diff*p0x
		camY -= diff*p0y
	}
	needRedraw()
}, {passive:true})
let keys = 0
const controls = {
	__proto__: null,
	KeyS: 1, ArrowDown: 1,
	KeyW: 2, ArrowUp: 2,
	KeyA: 4, ArrowLeft: 4,
	KeyD: 8, ArrowRight: 8,
	Space: 16, KeyH: 16
}, controls2 = { __proto__: null }

controls2.KeyH = down => { setLayer(+down) }
controls2.KeyG = down => { down && setGrid() }
controls2.KeyS = controls2.ArrowDown = (down, e) => { if(down && (e.shiftKey||layer)) return offsetTransaction(0, -1), true }
controls2.KeyW = controls2.ArrowUp = (down, e) => { if(down && (e.shiftKey||layer)) return offsetTransaction(0, 1), true }
controls2.KeyA = controls2.ArrowLeft = (down, e) => { if(down && (e.shiftKey||layer)) return offsetTransaction(-1, 0), true }
controls2.KeyD = controls2.ArrowRight = (down, e) => { if(down && (e.shiftKey||layer)) return offsetTransaction(1, 0), true }
controls2.KeyB = (down, e) => {
	if(!down || e.repeat || !drawing) return
	fill = fillEl.classList.toggle('selected')
	Sound.play(swoosh, fill*.5+1)
}
controls2.Space = (down, e) => {
	if(!down || e.repeat || !drawing) return
	selectEl(eraser)
}

document.addEventListener('keydown', e => { 
	if(document.activeElement != document.body || !e.isTrusted) return
	needRedraw()
	const fn = controls2[e.code]
	if(fn?.(true, e)) return
	keys |= controls[e.code]??0
})
document.addEventListener('keyup', e => {
	if(document.activeElement != document.body || !e.isTrusted) return
	const fn = controls2[e.code]
	if(fn?.(false, e)) return
	keys &= ~controls[e.code]??0
})

function checkDpi(){
	document.documentElement.style.fontSize = Math.round(devicePixelRatio)/devicePixelRatio*16+'px'
	w = Math.round(innerWidth*devicePixelRatio), h = Math.round(innerHeight*devicePixelRatio)
	if(w != ctx.canvas.width || h != ctx.canvas.height){
		ctx.canvas.width = w
		ctx.canvas.height = h
	}
}
window.addEventListener('resize', () => { checkDpi(); needRedraw() })
checkDpi()

const actx = new AudioContext()

window.addEventListener('focus', () => { actx.resume() })

const Sound = {
	create(len = 1, fn, sampleRate = 44100){
		const samples = Math.round(len*sampleRate)
		const buf = actx.createBuffer(1, samples, sampleRate)
		const data = buf.getChannelData(0)
		const step = 1/samples
		for(let i = 0, t = 0; i < samples; i++, t += step) data[i] = fn(t*len, t)
		return buf
	},
	sine: x => Math.sin(x*6.283185307179586),
	saw: x => 1+Math.floor(x)-x,
	triangle: x => {x = x-Math.floor(x); x *= 4; return x<1?x:x<3?2-x:x-4},
	square: x => {x = x-Math.floor(x); return (x<.5)*2-1 },
	attack: (t, x, pow=1) => t < x ? t/x : ((1-t)/(1-x))**pow,
	noise: x => {
		const xf = Math.floor(x); x -= xf
		let a = Math.imul(xf, 1597334673), b = a+1597334673|0
		a ^= -482951495; b ^= -482951495
		a ^= a>>15; b ^= b>>15
		a = Math.imul(a, -2073254261)&0xffff; b = Math.imul(b, -2073254261)&0xffff
		return (a + (b-a)*(3-2*x)*x*x) / 65535
	},
	play(note, freq = 1, vol = 1, off=0){
		const src = actx.createBufferSource()
		src.buffer = note
		
		src.playbackRate.value = freq
		if(vol != 1){
			const gain = actx.createGain()
			gain.gain.value = vol
			src.connect(gain).connect(actx.destination)
		}else src.connect(actx.destination)
		src.start(actx.currentTime+off)
	}
}
const note = Sound.create(0.12, (t, p) =>
	(Sound.sine(t*155.5)+Sound.sine(t*311)*.25+Sound.noise(t*10000)*.02) * Sound.attack(p, .005, 1, 4)
)
const scratch = Sound.create(0.03, (t, p) => {
	const vol = Math.min((1-p)*(1-p), p*200)
	let freq = 1000, amp = 1, value = 0
	while(freq < 10000) value += Sound.noise(t*freq)*amp, amp *= .75, freq *= 2
	return value*vol
})
const buzz = Sound.create(0.15, (t, p) => (Sound.triangle(t*27.5)+Sound.triangle(t*55)+Sound.triangle(t*110)*.5)*(1-p))
const swoosh = Sound.create(0.2, (t, p) => (Sound.noise(t*2000)+Sound.sine(t*(220+p*40))*.5)*Sound.attack(p, 0.1, 2))
const chime = Sound.create(0.25, (t, p) => Sound.triangle(t*Math.min(6,Math.floor(p*8)+3)*150)*Math.min(p*100,1)*Math.min((1-p)*2,1))

document.ontouchend = e => { e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.preventDefault() }
document.ondragstart = e => e.preventDefault()
document.addEventListener('wheel', e => { if(e.ctrlKey) e.preventDefault() }, {passive: false})

window.onbeforeunload = e => { transactionSize() && e.preventDefault() }

const balanceEl = $('#balance')
captureClick(balanceEl, e => {
	navigator.clipboard?.writeText('$'+(balance/1e4).toFixed(4)).then(() => {
		balanceEl.classList.add('copied')
		setTimeout(() => balanceEl.classList.remove('copied'), 2000)
	}, _ => _)
})

const onBalanceOrTransactionPriceChange = () => {
	transactionPrice > balance && token ? place.classList.add('disabled') : place.classList.remove('disabled')
}
const accountNotifBadge = $('#account-notif'), accountBalanceNotif = $('#balance-notif')
const onBalanceChange = (bal, balIncrease, notif) => {
	const b = Math.abs(bal / 1e4)
	let m='', n = Math.floor(b)+''
	while(n) m = n.slice(-3)+'\u2009'+m, n = n.slice(0,-3)
	balanceEl.textContent = (bal < 0 ? '-$' : '$')+m.slice(0,-1)
	balanceEl.dataset.amount2 = (b%1).toFixed(4).slice(1)
	balanceEl.style.color = bal < 0 ? '#f00' : ''
	accountNotifBadge.style.display = balIncrease ? '' : 'none'
	accountBalanceNotif.style.display = balIncrease ? '' : 'none'
	if(balIncrease) accountBalanceNotif.textContent =
		`You have earned $${(balIncrease/10000).toFixed(4)} since last check. Click to dismiss`
	if(notif) Sound.play(note, 4)
}
captureClick(accountBalanceNotif, () => {
	API.clearBalanceNotif()
	Sound.play(scratch, 2)
})
balanceChanged.push(onBalanceChange, onBalanceOrTransactionPriceChange)
transactionPriceChanged.push(onBalanceOrTransactionPriceChange)
tokenChanged.push(onBalanceOrTransactionPriceChange, (token, fromLS) => {
	if(token && loginPanel.classList.contains('shown')){
		if(fromLS && $('#forget-me').checked){
			setTokenLocal(token)
			delete localStorage.texel_token
		}
		openAccountPanel()
	}else if(!token && accountPanel.classList.contains('shown'))
		openAccountPanel()
})

captureClick($('#deposit'), () => {
	Sound.play(note, 4, 1)
	dwEl.classList.add('deposit')
	accountPanel.classList.remove('shown')
	dwNote.textContent = 'Minimum deposit amount: $' + (MIN_DEPOSIT/100).toFixed(2)
	dwInput.focus()
})

captureClick($('#withdraw'), () => {
	Sound.play(note, 4, 1)
	dwEl.classList.add('withdraw')
	accountPanel.classList.remove('shown')
	withdrawAvailEl.textContent = `Available: $${(Math.floor(balance/100)/100).toFixed(2)}`
	dwNote.textContent = `Minimum withdraw: $${(MIN_DEPOSIT/100).toFixed(2)}\nWithdraw fee: ${WITHDRAW_FEE}%`
	dwInput.focus()
})

captureClick($('#signout'), () => {
	fetch(API_ENDPOINT + '/revoke/' + token) // succeed or not we don't care
	delete localStorage.texel_token
	clearToken()
	accountPanel.classList.remove('shown')
})

const dwEl = $('#deposit-withdraw-panel'), dwInput = $('#deposit-withdraw-amount'), dwNote = $('#deposit-withdraw-notice'), withdrawAvailEl = $('#withdraw-avail')
captureClick($('#close-deposit-withdraw-panel'), () => {
	dwEl.classList.remove('deposit', 'withdraw')
	accountPanel.classList.add('shown')
	Sound.play(scratch)
})
captureClick(withdrawAvailEl, () => {
	dwAmt = Math.floor(balance/100)
	dwInput.value = '$' + (dwAmt/100).toFixed(2)
})

let dwAmt = 0
dwInput.addEventListener('update', () => {
	let s = dwInput.selectionStart, e = dwInput.selectionEnd, v = dwInput.value, v2 = v
	const nwAmt = Math.min(Math.floor(parseFloat(v2 = v2.slice(v2[0] == '$'))*100), 1e9)
	if(nwAmt >= 0) dwAmt = nwAmt
	v2 = '$'+v2.replace(/[^0-9.]+/g,'')
	s ||= 1; e ||= 1
	let s2 = 0, e1 = v.length, e2 = v2.length
	while(v[s2]==v2[s2]&&s2<s) s2++
	while(v[e1-1]==v2[e2-1]&&e1>e) e1--, e2--
	dwInput.value = v2
	dwInput.selectionStart = s2
	dwInput.selectionEnd = Math.max(e2, s2)
})
dwInput.addEventListener('change', () => {
	dwInput.value = '$' + (dwAmt/100).toFixed(2)
})
dwInput.addEventListener('focus', () => { dwInput.selectionStart = 1; dwInput.selectionEnd = 6e5 })
document.addEventListener('selectionchange', () => { document.activeElement.dispatchEvent(new Event('update')) }, true)
document.addEventListener('input', () => { document.activeElement.dispatchEvent(new Event('update')) })

captureClick($('#deposit-withdraw-button'), e => {
	if(dwAmt >= MIN_DEPOSIT){
		if(dwEl.classList.contains('withdraw')){
			if(dwAmt*100 > balance){
				Sound.play(buzz, 1, 1.5)
				withdrawAvailEl.classList.add('red')
				withdrawAvailEl.offsetHeight
				withdrawAvailEl.classList.remove('red')
				return
			}
			checkoutWithdraw(dwAmt)
		}else{
			checkoutDeposit(dwAmt, () => {
				dwEl.classList.remove('deposit')
			})
		}
		Sound.play(note, 4, 1)
		return
	}
	Sound.play(buzz, 1, 1.5)
	dwNote.classList.add('red')
	dwNote.offsetHeight
	dwNote.classList.remove('red')
})

captureClick($('#screen'), () => {
	$('.panel.shown')?.classList.remove('shown')
})

captureClick($('.gsi-button'), () => requestAuth())

console.error("%cBEWARE%c\nPasting anything here gives the author of the code total and unrestricted access to your account", 'font-size:3em;color:red;font-weight:bold', 'color:red')
console.warn("If you know what you\'re doing, read our API documentation, you could avoid losing your account: %s", location.origin+'/api')