export const csvCell=(value:unknown)=>{const text=String(value??'');return '"'+(/^[\s]*[=+@\-]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';};
export function downloadFile(name:string,content:string,type='text/csv;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
