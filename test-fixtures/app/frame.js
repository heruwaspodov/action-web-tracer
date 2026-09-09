function runChildAction() {
	void fetch('/api/child-frame');
}

document.querySelector('#child-action').addEventListener('click', runChildAction);
window.addEventListener('message', (event) => {
	if (event.data?.type === 'fixture-child-action') {
		runChildAction();
	}
});
